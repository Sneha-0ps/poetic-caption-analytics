import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp, Users, Heart, Share2, Award } from 'lucide-react';
export default function Analytics({ token, apiBaseUrl }) {

  const baseUrl = (apiBaseUrl && apiBaseUrl !== 'undefined') ? apiBaseUrl : 'http://localhost:3001';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAnalytics();
  }, []);
  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`${baseUrl}/api/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error("Error fetching analytics:", err);
    } finally {
      setLoading(false);
    }
  };
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <span className="pulse-spinner" style={{ width: '40px', height: '40px' }}></span>
      </div>
    );
  }
  const stats = data?.stats || { totalPosts: 0, completedPosts: 0, avgLikes: 0, totalLikes: 0, totalShares: 0, accuracyPercent: 100 };
  const timeline = data?.timeline || [];
  const tags = data?.tags || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* KPI Cards Row */}
      <div className="analytics-stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-title">Total Posts</span>
            <Users size={18} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div className="stat-value">{stats.totalPosts}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {stats.completedPosts} analyzed & complete
          </span>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-title">Simulated Likes</span>
            <Heart size={18} style={{ color: 'var(--accent-secondary)' }} />
          </div>
          <div className="stat-value">{stats.totalLikes}</div>
          <span className="stat-trend up" style={{ fontSize: '0.75rem' }}>
            Average: {stats.avgLikes} per post
          </span>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-title">Simulated Shares</span>
            <Share2 size={18} style={{ color: 'var(--accent-success)' }} />
          </div>
          <div className="stat-value">{stats.totalShares}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Engagement multiplier: 2.0x
          </span>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-title">ML Prediction Accuracy</span>
            <Award size={18} style={{ color: 'var(--accent-warning)' }} />
          </div>
          <div className="stat-value">{stats.accuracyPercent}%</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Based on Random Forest regression
          </span>
        </div>
      </div>
      {/* Chart Section */}
      {timeline.length === 0 ? (
        <div className="glass-card" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <TrendingUp size={48} style={{ marginBottom: '1.5rem', opacity: 0.3 }} />
          <h3>No published post analytics available yet.</h3>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Generate captions, click "Publish" on posts to simulate audience interaction, and watch performance metrics appear here in real-time.
          </p>
        </div>
      ) : (
        <div className="charts-row">
          {/* Timeline Chart */}
          <div className="glass-card chart-card">
            <div className="chart-header">
              <h4>Audience Engagement Trend</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Actual vs ML Predicted Score</p>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLikes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-secondary)" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="var(--accent-secondary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                  <Tooltip 
                    contentStyle={{ 
                      background: 'rgba(18, 24, 38, 0.95)', 
                      borderColor: 'var(--border-color)', 
                      borderRadius: '8px',
                      color: '#fff'
                    }} 
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  <Line type="monotone" dataKey="likes" name="Likes" stroke="var(--accent-secondary)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="shares" name="Shares" stroke="var(--accent-success)" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="predicted" name="Predicted Engagement" stroke="var(--accent-primary)" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Tag Performance Chart */}
          <div className="glass-card chart-card">
            <div className="chart-header">
              <h4>Mood Tag Coefficients</h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Avg Engagement per Tag</p>
            </div>
            <div className="chart-container">
              {tags.length === 0 ? (
                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  No tag performance data
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tags} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="tag" type="category" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip 
                      contentStyle={{ 
                        background: 'rgba(18, 24, 38, 0.95)', 
                        borderColor: 'var(--border-color)', 
                        borderRadius: '8px',
                        color: '#fff'
                      }} 
                    />
                    <Bar dataKey="avgEngagement" name="Avg Engagement Score" fill="url(#barGradient)" radius={[0, 4, 4, 0]}>
                      <defs>
                        <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="var(--accent-primary)" />
                          <stop offset="100%" stopColor="var(--accent-secondary)" />
                        </linearGradient>
                      </defs>
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}