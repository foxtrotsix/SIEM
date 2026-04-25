import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Shield, 
  Activity, 
  Users, 
  AlertTriangle, 
  Search, 
  Terminal, 
  Settings, 
  LayoutDashboard, 
  HardDrive,
  Cpu,
  RefreshCw,
  Bell,
  Globe,
  Network,
  Server,
  Zap,
  Info,
  Bot,
  Send,
  X,
  Trash2,
  Download
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';
import dayjs from 'dayjs';

const socket = io('http://localhost:3000');

function App() {
  const [agents, setAgents] = useState([]);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({ eventCount: 0, agentCount: 0, alertsByLevel: [] });
  const [health, setHealth] = useState({ webapp: {}, dns: {}, network: {} });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [suspects, setSuspects] = useState([]);
  const [selectedEventGroup, setSelectedEventGroup] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(null); // Mode Isolasi

  const exportSecurityData = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // 1. Raw Logs (All Events)
    const rawData = JSON.stringify(events, null, 2);
    
    // 2. High Priority Incidents (Level >= 7)
    const incidentData = JSON.stringify(events.filter(e => e.level >= 7), null, 2);
    
    // 3. Structured Threat Intelligence
    const groupedIntel = [...new Map(events.filter(e => e.ai_intel && e.ai_intel.startsWith('{')).reverse().map(e => [`${e.rule_id}-${e.agent_id}`, e])).values()].reverse();
    const intelData = JSON.stringify(groupedIntel.map(e => ({
        timestamp: e.timestamp,
        agent: e.agent_id,
        attack_type: e.description,
        forensic_data: JSON.parse(e.ai_intel)
    })), null, 2);

    const downloadFile = (content, fileName) => {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    downloadFile(rawData, `arch_RawLogs_${timestamp}.json`);
    downloadFile(incidentData, `arch_SecurityIncidents_${timestamp}.json`);
    downloadFile(intelData, `arch_ThreatIntel_${timestamp}.json`);
  };

  const fetchData = async () => {
    try {
      const [agentsRes, eventsRes, statsRes, healthRes, suspectsRes] = await Promise.all([
        fetch('http://localhost:3000/api/agents'),
        fetch(`http://localhost:3000/api/events${selectedAgentId ? `?agentId=${selectedAgentId}` : ''}`),
        fetch(`http://localhost:3000/api/stats${selectedAgentId ? `?agentId=${selectedAgentId}` : ''}`),
        fetch('http://localhost:3000/api/health'),
        fetch('http://localhost:3000/api/suspects')
      ]);
      setAgents(await agentsRes.json());
      setEvents(await eventsRes.json());
      setStats(await statsRes.json());
      setHealth(await healthRes.json());
      setSuspects(await suspectsRes.json());
    } catch (err) {
      console.error('Failed to fetch data', err);
    }
  };

  useEffect(() => {
    // Using a separate async function inside useEffect to handle initial load
    fetchData();

    socket.on('new_event', (event) => {
      // Only add to list if global or matching selected agent
      if (!selectedAgentId || event.agent_id === selectedAgentId) {
        setEvents(prev => [event, ...prev].slice(0, 99));
      }
      // Always refresh agents to show alert status on cards
      fetchData();
    });

    socket.on('event_update', (updatedEvent) => {
      setEvents(prev => prev.map(e => (e.id === updatedEvent.id || (e.rule_id === updatedEvent.rule_id && e.agent_id === updatedEvent.agent_id)) ? updatedEvent : e));
    });
    
    socket.on('agent_updated', () => {
      console.log('Real-time update: Agents changed');
      fetchData(); // Refresh agent list and counts
    });

    socket.on('stats_updated', () => {
       fetchData(); // Refresh stats and charts
    });

    return () => {
      socket.off('new_event');
      socket.off('agent_updated');
      socket.off('stats_updated');
    };
  }, [selectedAgentId]); // Re-fetch when isolation mode changes

  // Helper functions for dynamic data
  const getChartData = () => {
    if (events.length === 0) return [];
    
    // Group events by hour for the last 24h (or whatever data we have)
    const hours = {};
    events.forEach(e => {
      const hour = dayjs(e.timestamp).format('HH:00');
      hours[hour] = (hours[hour] || 0) + 1;
    });

    return Object.entries(hours)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const getTopSources = () => {
    if (events.length === 0) return [];
    
    const sources = {};
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/; // Basic IP regex

    events.forEach(e => {
        const match = e.full_log.match(ipRegex);
        const src = match ? match[0] : 'Unknown';
        sources[src] = (sources[src] || 0) + 1;
    });

    return Object.entries(sources)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  };

  const chartData = getChartData();
  const topSources = getTopSources();

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <Shield size={32} color="#3b82f6" />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>arch <span style={{ color: '#3b82f6' }}>SOC</span></h1>
        </div>

        {selectedAgentId && (
            <div className="glass-panel" style={{ padding: '0.5rem', marginBottom: '1rem', border: '1px solid #3b82f6', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 'bold', textTransform: 'uppercase' }}>Isolated Monitoring</span>
                <span style={{ fontSize: '0.85rem', color: 'white', fontWeight: 600 }}>{agents.find(a => a.id === selectedAgentId)?.name || selectedAgentId}</span>
                <button 
                  onClick={() => setSelectedAgentId(null)}
                  style={{ fontSize: '0.7rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                >
                  Return to Global
                </button>
            </div>
        )}

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <NavItem icon={<LayoutDashboard size={20}/>} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<Users size={20}/>} label="Agents" active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
          <NavItem icon={<AlertTriangle size={20}/>} label="Suspects" active={activeTab === 'suspects'} onClick={() => setActiveTab('suspects')} />
          <NavItem icon={<Bell size={20}/>} label="Events" active={activeTab === 'events'} onClick={() => setActiveTab('events')} />
          <NavItem icon={<Globe size={20}/>} label="Availability" active={activeTab === 'availability'} onClick={() => setActiveTab('availability')} />
          <NavItem icon={<Zap size={20}/>} label="Threat Intel" active={activeTab === 'intel'} onClick={() => setActiveTab('intel')} />
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <NavItem 
              icon={<Bot size={20} color={isChatOpen ? "#3b82f6" : undefined} />} 
              label="Ask arch AI" 
              active={isChatOpen} 
              onClick={() => setIsChatOpen(!isChatOpen)} 
            />
          </div>
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <NavItem icon={<Settings size={20}/>} label="Settings" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div style={{ position: 'relative', width: '400px' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={18} />
            <input 
              type="text" 
              placeholder="Search trends, agents, or CIDR..." 
              className="glass-panel" 
              style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', background: 'rgba(255,255,255,0.05)', height: '42px', borderRadius: '12px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Trash2 
              className="stat-icon" 
              size={20} 
              style={{ width: '40px', height: '40px', cursor: 'pointer', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.2)' }} 
              onClick={async () => {
                if (window.confirm('Development Mode: Clear all logs?')) {
                  await fetch('http://localhost:3000/api/events', { method: 'DELETE' });
                  fetchData();
                }
              }} 
            />
            <RefreshCw className="stat-icon" size={20} style={{ width: '40px', height: '40px', cursor: 'pointer' }} onClick={fetchData} />
            <Download className="stat-icon" size={20} style={{ width: '40px', height: '40px', cursor: 'pointer', color: '#60a5fa' }} onClick={exportSecurityData} />
            <Bell className="stat-icon" size={20} style={{ width: '40px', height: '40px', cursor: 'pointer' }} />
            <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(45deg, #3b82f6, #818cf8)' }}></div>
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Operator</span>
            </div>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <>
            <div className="grid-stats">
              <StatCard icon={<AlertTriangle />} label="Total Events" value={stats.eventCount.toLocaleString()} />
              <StatCard icon={<Users />} label="Active Agents" value={agents.filter(a => a.status === 'active').length} color="#10b981" />
              <StatCard icon={<Cpu />} label="High Severity" value={events.filter(e => e.level >= 10).length} color="#ef4444" />
              <StatCard icon={<Activity />} label="Log Flow" value={events.length > 0 ? `${(events.length / agents.length || 1).toFixed(1)} lps` : '0 lps'} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div className="glass-panel" style={{ position: 'relative' }}>
                <h3 style={{ marginBottom: '1.5rem', color: '#f1f5f9' }}>Alert Trends</h3>
                {chartData.length === 0 ? (
                    <EmptyState message="No security events recorded yet." />
                ) : (
                    <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorLevel" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                        <YAxis stroke="#64748b" fontSize={12} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                        <Area type="monotone" dataKey="value" stroke="#3b82f6" fillOpacity={1} fill="url(#colorLevel)" />
                        </AreaChart>
                    </ResponsiveContainer>
                    </div>
                )}
              </div>

              <div className="glass-panel" style={{ position: 'relative' }}>
                <h3 style={{ marginBottom: '1.5rem', color: '#f1f5f9' }}>Top Attack Sources</h3>
                {topSources.length === 0 ? (
                    <EmptyState message="No attack sources identified." />
                ) : (
                    <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={topSources} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={100} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                        <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                            {topSources.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : '#3b82f6'} fillOpacity={0.8} />
                            ))}
                        </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    </div>
                )}
              </div>
            </div>

            <div className="glass-panel">
              <h3 style={{ marginBottom: '1.5rem', color: '#f1f5f9' }}>Recent Security Events</h3>
              {events.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Awaiting events from agents...</div>
              ) : (
                <table className="table-container">
                    <thead>
                    <tr>
                        <th className="table-header">Timestamp</th>
                        <th className="table-header">Agent</th>
                        <th className="table-header">Severity</th>
                        <th className="table-header">Description</th>
                        <th className="table-header">Source</th>
                    </tr>
                    </thead>
                    <tbody>
                    {[...(selectedAgentId ? events.filter(e => e.agent_id === selectedAgentId) : events)].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 50).map((event, i) => (
                        <tr key={i} className="table-row">
                        <td className="table-cell">{dayjs(event.timestamp).format('HH:mm:ss')}</td>
                        <td className="table-cell" style={{ fontWeight: 600, color: event.agent_id === selectedAgentId ? '#3b82f6' : 'inherit' }}>
                            {agents.find(a => a.id === event.agent_id)?.name || event.agent_id}
                        </td>
                        <td className="table-cell">
                            <span className={`severity-pill ${getSeverityClass(event.level)}`}>
                            Level {event.level}
                            </span>
                        </td>
                        <td className="table-cell">{event.description}</td>
                        <td className="table-cell">{event.source}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {activeTab === 'agents' && (
          <div className="tab-pane">
            <header className="page-header">
                <h2>Protected Infrastructure Nodes</h2>
                <p>Real-time status and telemetry from assigned arch-SOC agents</p>
            </header>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {agents.map((agent, i) => (
                    <div 
                        key={i} 
                        className={`glass-panel agent-card ${agent.last_high_level >= 7 ? 'alert-pulse' : ''} ${selectedAgentId === agent.id ? 'active-border' : ''}`}
                        style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.3s ease' }}
                        onClick={() => {
                            setSelectedAgentId(agent.id);
                            setActiveTab('dashboard');
                        }}
                    >
                        {agent.last_high_level >= 7 && (
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#ef4444' }}></div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ 
                                    width: '48px', 
                                    height: '48px', 
                                    borderRadius: '12px', 
                                    background: agent.last_high_level >= 7 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: agent.last_high_level >= 7 ? '#ef4444' : '#3b82f6'
                                }}>
                                    <Server size={24} />
                                </div>
                                <div>
                                    <h4 style={{ color: 'white', fontWeight: 700 }}>{agent.name}</h4>
                                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{agent.ip}</span>
                                </div>
                            </div>
                            <div className={`status-pill ${agent.status}`}>
                                {agent.status}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                            <div className="agent-mini-stat">
                                <div className="label">OS</div>
                                <div className="value" style={{ fontSize: '0.8rem' }}>{agent.os}</div>
                            </div>
                            <div className="agent-mini-stat">
                                <div className="label">Last Seen</div>
                                <div className="value">{dayjs(agent.last_keepalive).format('HH:mm:ss')}</div>
                            </div>
                        </div>

                        {agent.last_high_level >= 7 && (
                            <div style={{ marginTop: '1rem', padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <AlertTriangle size={14} color="#ef4444" />
                                <span style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600 }}>CRITICAL INCIDENT DETECTED</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="tab-pane">
            <header className="page-header">
                <h2>Security Incident Explorer</h2>
                <p>Categorized events summarized across infrastructure</p>
            </header>
            
            {!selectedEventGroup ? (
                <div className="grid-summary">
                    {groupEvents(events).map((group, idx) => (
                        <div key={idx} className="glass-panel incident-card" onClick={() => setSelectedEventGroup(group)}>
                            <div className={`severity-indicator ${getSeverityClass(group.level)}`}></div>
                            <div className="card-header">
                                <span className="cat-badge">{group.category}</span>
                                <span className="event-count">{group.items.length} Events</span>
                            </div>
                            <h4 className="card-title">{group.description}</h4>
                            <div className="card-footer">
                                <span>Level {group.level}</span>
                                <span>Recent: {dayjs(group.lastSeen).format('HH:mm')}</span>
                            </div>
                        </div>
                    ))}
                    {events.length === 0 && <EmptyState message="No security incidents currently active." />}
                </div>
            ) : (
                <div className="glass-panel">
                    <button className="back-btn" onClick={() => setSelectedEventGroup(null)}>← Back to Summary</button>
                    <h3>Logs for: {selectedEventGroup.description}</h3>
                    <table className="table-container mt-4">
                        <thead>
                            <tr>
                                <th className="table-header">Time</th>
                                <th className="table-header">Agent</th>
                                <th className="table-header">Source</th>
                                <th className="table-header">Raw Log Snippet</th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedEventGroup.items.map((e, i) => (
                                <tr key={i} className="table-row">
                                    <td className="table-cell">{dayjs(e.timestamp).format('HH:mm:ss')}</td>
                                    <td className="table-cell">{e.agent_id}</td>
                                    <td className="table-cell">{e.source}</td>
                                    <td className="table-cell" title={e.full_log}>
                                        <div style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {e.full_log}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
          </div>
        )}

        {activeTab === 'availability' && (
            <div>
                 <header className="page-header">
                    <h2>Availability & Uptime Control</h2>
                    <p>Real-time heartbeat of critical infrastructure services</p>
                </header>
                <div className="grid-stats">
                    <StatusCard icon={<Server />} label="Web App (Nginx)" status={health.webapp.status} />
                    <StatusCard icon={<Globe />} label="DNS Services" status={health.dns.status} />
                    <StatusCard icon={<Network />} label="Internal Network" status={health.network.status} />
                    <StatusCard icon={<Zap />} label="SIEM Manager" status="up" />
                </div>
                
                <div className="glass-panel mt-6">
                    <h3>Service Statistics</h3>
                    <div className="uptime-bar-container">
                        <div className="u-label">Overall Uptime Score</div>
                        <div className="u-rail"><div className="u-fill" style={{ width: '99.9%' }}></div></div>
                        <div className="u-val">99.9%</div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'intel' && (
            <div className="intel-workflow">
                <header className="page-header">
                    <h2>SOC Threat Intelligence Pipeline</h2>
                    <p>Strategic analysis of detected patterns and automated intel lifecycle</p>
                </header>
                
                <div className="intel-columns">
                    <IntelColumn 
                        title="Data Collection" 
                        items={[...new Map([...events].reverse().slice(-50).map(e => [`${e.rule_id}-${e.agent_id}`, e])).values()]
                            .reverse()
                            .slice(0, 10)
                            .map(e => `${e.description} detected from ${e.agent_id}`)} 
                        icon={<Search size={18}/>} 
                    />
                    <IntelColumn 
                        title="Correlation" 
                        items={[...new Map(events.filter(e => e.ai_intel && e.ai_intel.startsWith('{')).reverse().map(e => [`${e.rule_id}-${e.agent_id}`, e])).values()]
                            .reverse()
                            .slice(0, 10)
                            .map(e => {
                                try {
                                    const p = JSON.parse(e.ai_intel);
                                    return p.correlation;
                                } catch { return `Rule #${e.rule_id} Active`; }
                            })} 
                        icon={<Activity size={18}/>} 
                    />
                    <IntelColumn 
                        title="Manual Analysis" 
                        items={[...new Map(events.filter(e => e.ai_intel && e.ai_intel.startsWith('{')).reverse().map(e => [`${e.rule_id}-${e.agent_id}`, e])).values()]
                            .reverse()
                            .slice(0, 10)
                            .map(e => {
                                try {
                                    const p = JSON.parse(e.ai_intel);
                                    return p.manual_analysis;
                                } catch { return "Verification in progress..."; }
                            })} 
                        icon={<Info size={18}/>} 
                    />
                    <IntelColumn 
                        title="Actionable Intelligence" 
                        items={[...new Map(events.filter(e => e.ai_intel && e.ai_intel.startsWith('{')).reverse().map(e => [`${e.rule_id}-${e.agent_id}`, e])).values()]
                            .reverse()
                            .slice(0, 10)
                            .map(e => {
                                try {
                                    const p = JSON.parse(e.ai_intel);
                                    return p.actionable;
                                } catch { return e.ai_intel; }
                            })}
                        icon={<Zap size={18}/>} 
                    />
                </div>

                <div className="glass-panel mt-6">
                     <h3>Source Metadata Analysis</h3>
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                        <div>
                            <p className="text-secondary mb-2">Primary Incident Sources</p>
                            {topSources.map((s, i) => (
                                <div key={i} className="source-item">
                                    <span>{s.name}</span>
                                    <span className="badge">{s.value} incidents</span>
                                </div>
                            ))}
                        </div>
                        <div>
                            <p className="text-secondary mb-2">Intelligence Source Feed</p>
                            <div className="feed-item">arch-Internal-Db: 100% operational</div>
                            <div className="feed-item">Public CVE Feed: Syncing...</div>
                        </div>
                     </div>
                </div>
            </div>
        )}

        {activeTab === 'suspects' && (
          <div className="tab-pane">
            <header className="page-header">
                <h2>Intrusion Suspect List</h2>
                <p>Tracking suspicious entities attempting to access your infrastructure</p>
            </header>
            
            <div className="glass-panel">
                {suspects.length === 0 ? (
                    <EmptyState message="No suspicious intrusions detected yet. Staying vigilant!" />
                ) : (
                    <table className="table-container">
                        <thead>
                            <tr>
                                <th className="table-header">Intruder IP</th>
                                <th className="table-header">Location</th>
                                <th className="table-header">City</th>
                                <th className="table-header">Threat Level</th>
                                <th className="table-header">Hits</th>
                                <th className="table-header">Last Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {suspects.map((s, i) => (
                                <tr key={i} className="table-row">
                                    <td className="table-cell" style={{ fontWeight: 800, color: '#f87171' }}>{s.ip}</td>
                                    <td className="table-cell text-white">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Globe size={14} color="#3b82f6" />
                                            {s.country}
                                        </div>
                                    </td>
                                    <td className="table-cell">{s.city}</td>
                                    <td className="table-cell">
                                        <span className={`severity-pill ${s.threat_level === 'Malicious' ? 'sev-high' : 'sev-medium'}`}>
                                            {s.threat_level}
                                        </span>
                                    </td>
                                    <td className="table-cell">{s.count} times</td>
                                    <td className="table-cell text-secondary">{dayjs(s.last_seen).format('MMM D, HH:mm')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
                <div className="glass-panel text-center" style={{ borderLeft: '4px solid #ef4444' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ef4444' }}>{suspects.length}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>TOTAL UNIQUE INTRUDERS</div>
                </div>
                <div className="glass-panel text-center" style={{ borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#3b82f6' }}>
                        {suspects.reduce((acc, curr) => acc + curr.count, 0)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>TOTAL ATTEMPTS BLOCKED</div>
                </div>
                <div className="glass-panel text-center" style={{ borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981' }}>
                        {new Set(suspects.map(s => s.country)).size}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>COUNTRIES DETECTED</div>
                </div>
            </div>
          </div>
        )}
      </main>
      <AIChatAssistant isOpen={isChatOpen} setIsOpen={setIsChatOpen} onExport={exportSecurityData} selectedAgentId={selectedAgentId} />
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <div 
      onClick={onClick}
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '0.75rem', 
        padding: '0.75rem 1rem', 
        borderRadius: '12px',
        cursor: 'pointer',
        background: active ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        color: active ? '#3b82f6' : '#94a3b8',
        transition: 'all 0.2s ease',
        fontWeight: active ? 600 : 400
      }}
    >
      {icon}
      <span>{label}</span>
      {active && <div style={{ marginLeft: 'auto', width: '4px', height: '4px', borderRadius: '50%', background: '#3b82f6' }}></div>}
    </div>
  );
}

function StatCard({ icon, label, value, color = '#3b82f6' }) {
  return (
    <div className="glass-panel stat-card">
      <div className="stat-icon" style={{ background: `${color}15`, color: color }}>
        {React.cloneElement(icon, { size: 24 })}
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({ message }) {
    return (
        <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#64748b' }}>
            <Activity size={48} opacity={0.2} />
            <p style={{ fontSize: '0.875rem' }}>{message}</p>
        </div>
    );
}

const getSeverityClass = (level) => {
    if (level >= 10) return 'sev-high';
    if (level >= 5) return 'sev-medium';
    return 'sev-low';
};

// --- Supplementary Components ---

function StatusCard({ icon, label, status }) {
    const isUp = status === 'up';
    return (
        <div className="glass-panel stat-card text-center">
            <div className="status-icon-container" style={{ color: isUp ? '#10b981' : '#ef4444' }}>
                {icon}
            </div>
            <div className="stat-value" style={{ color: isUp ? '#10b981' : '#ef4444' }}>
                {status?.toUpperCase() || 'OFF'}
            </div>
            <div className="stat-label">{label}</div>
        </div>
    );
}

function IntelColumn({ title, items, icon }) {
    return (
        <div className="intel-col glass-panel">
            <div className="col-header">
                {icon}
                <span>{title}</span>
            </div>
            <div className="col-items">
                {items.map((item, idx) => (
                    <div key={idx} className="intel-item">{item}</div>
                ))}
            </div>
        </div>
    );
}

function AIChatAssistant({ isOpen, setIsOpen, onExport, selectedAgentId }) {
    const [messages, setMessages] = useState([{ role: 'bot', text: selectedAgentId ? `Hello! I am your arch SOC Analyst. I see you are focused on agent [${selectedAgentId}]. How can I help you analyze its telemetry?` : 'Hello! I am your arch SOC Analyst. How can I help you analyze the SIEM today?' }]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef(null);

    const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    useEffect(() => { scrollToBottom(); }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userMessage = { role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch('http://localhost:3000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: input, 
                    agentId: selectedAgentId,
                    history: messages.slice(-6).map(m => ({ role: m.role === 'bot' ? 'model' : 'user', text: m.text })) 
                })
            });
            const data = await res.json();
            setMessages(prev => [...prev, { role: 'bot', text: data.text }]);
        } catch {
            setMessages(prev => [...prev, { role: 'bot', text: 'Error connecting to my brain. Please check the Manager log.' }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {isOpen && (
                <div className="chat-window glass-panel">
                    <div className="chat-header">
                        <div className="flex items-center gap-2">
                            <Bot size={20} className="text-blue-400" />
                            <h4 className="font-bold" style={{ color: 'white' }}>arch SOC Assistant</h4>
                        </div>
                        <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                            <X size={20} />
                        </button>
                    </div>

                    <div className="chat-body">
                        {messages.map((m, i) => (
                            <div key={i} className={`chat-bubble ${m.role === 'user' ? 'user' : 'bot'}`}>
                                {m.text}
                            </div>
                        ))}
                        {loading && <div className="chat-bubble bot italic">Brainstorming...</div>}
                        <div ref={chatEndRef} />
                    </div>

                    <form className="chat-footer" onSubmit={handleSendMessage}>
                        <input 
                            type="text" 
                            placeholder="Ask me anything..." 
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button type="submit" disabled={loading}><Send size={18}/></button>
                    </form>
                    <div style={{ padding: '0 15px 15px 15px' }}>
                        <button 
                            onClick={onExport}
                            className="glass-panel"
                            style={{
                                width: '100%',
                                padding: '10px',
                                background: 'rgba(74, 144, 226, 0.1)',
                                border: '1px solid rgba(74, 144, 226, 0.3)',
                                color: '#60a5fa',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold'
                            }}
                        >
                            <Download size={14}/> Export All Forensic Reports (.JSON)
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

const groupEvents = (events) => {
    const groups = {};
    events.forEach(e => {
        const key = e.description;
        if (!groups[key]) {
            groups[key] = {
                description: e.description,
                category: e.source,
                level: e.level,
                lastSeen: e.timestamp,
                items: []
            };
        }
        groups[key].items.push(e);
        if (new Date(e.timestamp) > new Date(groups[key].lastSeen)) {
            groups[key].lastSeen = e.timestamp;
        }
    });
    return Object.values(groups).sort((a,b) => b.level - a.level);
};

export default App;
