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
  X
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
  const [selectedEventGroup, setSelectedEventGroup] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const fetchData = async () => {
    try {
      const [agentsRes, eventsRes, statsRes, healthRes] = await Promise.all([
        fetch('http://localhost:3000/api/agents'),
        fetch('http://localhost:3000/api/events'),
        fetch('http://localhost:3000/api/stats'),
        fetch('http://localhost:3000/api/health')
      ]);
      setAgents(await agentsRes.json());
      setEvents(await eventsRes.json());
      setStats(await statsRes.json());
      setHealth(await healthRes.json());
    } catch (err) {
      console.error('Failed to fetch data', err);
    }
  };

  useEffect(() => {
    // Using a separate async function inside useEffect to handle initial load
    const init = async () => {
      await fetchData();
    };
    init();

    socket.on('new_event', (event) => {
      setEvents(prev => [event, ...prev.slice(0, 49)]);
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
  }, []);

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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>ABINARA <span style={{ color: '#3b82f6' }}>SOC</span></h1>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <NavItem icon={<LayoutDashboard size={20}/>} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<Users size={20}/>} label="Agents" active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
          <NavItem icon={<Bell size={20}/>} label="Events" active={activeTab === 'events'} onClick={() => setActiveTab('events')} />
          <NavItem icon={<Globe size={20}/>} label="Availability" active={activeTab === 'availability'} onClick={() => setActiveTab('availability')} />
          <NavItem icon={<Zap size={20}/>} label="Threat Intel" active={activeTab === 'intel'} onClick={() => setActiveTab('intel')} />
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <NavItem 
              icon={<Bot size={20} color={isChatOpen ? "#3b82f6" : undefined} />} 
              label="Ask Abinara AI" 
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
            <RefreshCw className="stat-icon" size={20} style={{ width: '40px', height: '40px', cursor: 'pointer' }} onClick={fetchData} />
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
                    {events.map((event, i) => (
                        <tr key={i} className="table-row">
                        <td className="table-cell">{dayjs(event.timestamp).format('HH:mm:ss')}</td>
                        <td className="table-cell">{agents.find(a => a.id === event.agent_id)?.name || event.agent_id}</td>
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
                    <IntelColumn title="Data Collection" items={events.slice(0, 3).map(e => `Raw ingestion from ${e.source}`)} icon={<Search size={18}/>} />
                    <IntelColumn title="Correlation" items={events.filter(e => e.level >= 10).map(e => `Detected pattern match: Rule #${e.rule_id}`)} icon={<Activity size={18}/>} />
                    <IntelColumn title="Manual Analysis" items={['Verifying IP reputation...', 'Check payload against known XSS strings']} icon={<Info size={18}/>} />
                    <IntelColumn 
                        title="Actionable Intelligence" 
                        items={events.filter(e => e.level >= 7 && e.ai_intel).map(e => e.ai_intel)} 
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
                            <div className="feed-item">ABINARA-Internal-Db: 100% operational</div>
                            <div className="feed-item">Public CVE Feed: Syncing...</div>
                        </div>
                     </div>
                </div>
            </div>
        )}

      </main>
      <AIChatAssistant isOpen={isChatOpen} setIsOpen={setIsChatOpen} />
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

function AIChatAssistant({ isOpen, setIsOpen }) {
    const [messages, setMessages] = useState([{ role: 'bot', text: 'Hello! I am your Abinara SOC Analyst. How can I help you analyze the SIEM today?' }]);
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
                    history: messages.slice(-6).map(m => ({ role: m.role === 'bot' ? 'model' : 'user', text: m.text })) 
                })
            });
            const data = await res.json();
            setMessages(prev => [...prev, { role: 'bot', text: data.text }]);
        } catch (err) {
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
                            <h4 className="font-bold" style={{ color: 'white' }}>Abinara SOC Assistant</h4>
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
