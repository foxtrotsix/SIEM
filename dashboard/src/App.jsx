import React, { useState, useEffect } from 'react';
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
  Bell
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
  const [activeTab, setActiveTab] = useState('dashboard');

  const fetchData = async () => {
    try {
      const [agentsRes, eventsRes, statsRes] = await Promise.all([
        fetch('http://localhost:3000/api/agents'),
        fetch('http://localhost:3000/api/events'),
        fetch('http://localhost:3000/api/stats')
      ]);
      setAgents(await agentsRes.json());
      setEvents(await eventsRes.json());
      setStats(await statsRes.json());
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
      setStats(prev => ({ ...prev, eventCount: prev.eventCount + 1 }));
    });

    return () => socket.off('new_event');
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
          <NavItem icon={<Activity size={20}/>} label="Events" active={activeTab === 'events'} onClick={() => setActiveTab('events')} />
          <NavItem icon={<HardDrive size={20}/>} label="Inventory" active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} />
          <NavItem icon={<Terminal size={20}/>} label="Log Analysis" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
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

        {activeTab === 'agents' && (
           <div className="glass-panel">
              <h3 style={{ marginBottom: '1.5rem', color: '#f1f5f9' }}>Infrastructure Agents</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {agents.map((agent, i) => (
                  <div key={i} className="glass-panel" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h4 style={{ fontWeight: 700 }}>{agent.name}</h4>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span className={`status-indicator ${agent.status === 'active' ? 'status-online' : ''}`} style={{ background: agent.status === 'active' ? '#10b981' : '#64748b' }}></span>
                        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: agent.status === 'active' ? '#10b981' : '#94a3b8' }}>{agent.status}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <p><strong>ID:</strong> {agent.id}</p>
                      <p><strong>IP:</strong> {agent.ip}</p>
                      <p><strong>OS:</strong> {agent.os}</p>
                      <p><strong>Last Seen:</strong> {dayjs(agent.last_keepalive).format('YYYY-MM-DD HH:mm')}</p>
                    </div>
                  </div>
                ))}
              </div>
           </div>
        )}
      </main>
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

export default App;
