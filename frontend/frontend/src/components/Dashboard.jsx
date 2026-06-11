import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Sparkles, TrendingUp, Copy, Check, Image as ImageIcon, Clock, Send, Eye } from 'lucide-react';

export default function Dashboard({ token, apiBaseUrl }) {
  const baseUrl = (apiBaseUrl && apiBaseUrl !== 'undefined') ? apiBaseUrl : 'http://localhost:3001';

  const [file, setFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentPostId, setCurrentPostId] = useState(null);
  const [currentPost, setCurrentPost] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [postsHistory, setPostsHistory] = useState([]);

  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    fetchHistory();
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch(`${baseUrl}/api/posts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) setPostsHistory(await response.json());
    } catch (err) {
      console.error("Error fetching post history:", err);
    }
  };

  // Normalise a post object from any source (MongoDB lean, local JSON, polling)
  // so the UI always gets a consistent shape.
  const normalisePost = (post) => {
    if (!post) return null;
    // Handle Mongoose docs that come back as plain objects via JSON serialisation
    const raw = post._doc || post;
    const content = raw.content || {};
    return {
      ...raw,
      content: {
        moodTags:      content.moodTags      ?? [],
        poeticCaption: content.poeticCaption ?? '',
        variations:    content.variations    ?? [],
      },
      analytics: {
        predictedScore: raw.analytics?.predictedScore ?? 0,
        actualLikes:    raw.analytics?.actualLikes    ?? 0,
        actualShares:   raw.analytics?.actualShares   ?? 0,
      }
    };
  };

  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) {
      clearActivePost();
      const f = e.dataTransfer.files[0];
      setFile(f);
      setImagePreview(URL.createObjectURL(f));
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      clearActivePost();
      const f = e.target.files[0];
      setFile(f);
      setImagePreview(URL.createObjectURL(f));
    }
  };

  const clearActivePost = () => {
    setCurrentPost(null);
    setCurrentPostId(null);
    setCurrentStep(0);
    setLoading(false);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };

  const resetDashboard = () => {
    clearActivePost();
    setFile(null);
    setImagePreview('');
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setCurrentStep(1);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const uploadRes = await fetch(`${baseUrl}/api/posts/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!uploadRes.ok) throw new Error("Image upload failed");
      const uploadData = await uploadRes.json();
      setCurrentPostId(uploadData.postId);
      setCurrentStep(2);
      setTimeout(() => setCurrentStep(3), 1200);
      startPolling(uploadData.postId);
    } catch (err) {
      console.error(err);
      setCurrentStep(-1);
      setLoading(false);
    }
  };

  const startPolling = (postId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${baseUrl}/api/posts/${postId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Status check failed");
        const post = normalisePost(await response.json());
        if (post.status === 'completed') {
          clearInterval(pollIntervalRef.current);
          setCurrentPost(post);
          setCurrentStep(5);
          setLoading(false);
          fetchHistory();
        } else if (post.status === 'failed') {
          clearInterval(pollIntervalRef.current);
          setCurrentStep(-1);
          setLoading(false);
        } else if (post.status === 'processing') {
          if (post.content?.variations?.length > 0) setCurrentStep(4);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 1000);
  };

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handlePublish = async () => {
    if (!currentPost) return;
    setPublishing(true);
    try {
      const response = await fetch(`${baseUrl}/api/posts/${currentPost._id || currentPostId}/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentPost(normalisePost(data.post));
        fetchHistory();
      }
    } catch (err) {
      console.error("Publishing error:", err);
    } finally {
      setPublishing(false);
    }
  };

  // Load a past post — re-fetch the full post from the server so we always
  // get the complete, freshly-serialised object (avoids partial history data).
  const loadPastPost = async (post) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setLoading(false);
    setFile(null);
    setImagePreview(post.imageUrl || '');
    setCurrentPostId(post._id);
    setCurrentStep(5);

    // Re-fetch full post to guarantee all nested fields are present
    try {
      const response = await fetch(`${baseUrl}/api/posts/${post._id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setCurrentPost(normalisePost(await response.json()));
      } else {
        // Fallback: use the history item directly but normalise it
        setCurrentPost(normalisePost(post));
      }
    } catch {
      setCurrentPost(normalisePost(post));
    }
  };

  const steps = [
    { label: "Uploading Image Assets",          desc: "Transmitting image files to backend server" },
    { label: "Dispatching Asynchronous Task",   desc: "Pushing job payload to background worker" },
    { label: "AI Composition & Drafting",        desc: "Gemini 2.5 Flash analyzing visual semantics" },
    { label: "Predictive Analytics Evaluation", desc: "Flask Random Forest assessing tag coefficients" },
    { label: "Composition Complete",            desc: "Captions successfully evaluated and saved" }
  ];

  const isUnpublished = !currentPost?.analytics?.actualLikes;

  // Safe accessors with fallbacks
  const moodTags  = currentPost?.content?.moodTags  ?? [];
  const variations = currentPost?.content?.variations ?? [];

  return (
    <div className="dashboard-grid">
      {/* ── Left Column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div className="glass-card">
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Sparkles size={20} style={{ color: 'var(--accent-primary)' }} />
            Creative Studio
          </h3>

          {!imagePreview ? (
            <div
              className="upload-zone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <UploadCloud className="upload-icon" size={48} />
              <div>
                <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  Drag & drop image here
                </p>
                <p style={{ fontSize: '0.85rem' }}>or click to browse from system (JPEG, PNG, WEBP)</p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden-file-input"
                onChange={handleFileChange}
                accept="image/*"
              />
            </div>
          ) : (
            <div className="preview-card">
              <div className="preview-image-container">
                <img src={imagePreview} alt="Preview" className="preview-image" />
              </div>
              {!loading && currentStep === 0 && (
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetDashboard}>
                    Clear
                  </button>
                  <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit}>
                    Analyze Composition
                  </button>
                </div>
              )}
              {!loading && currentStep === 5 && (
                <button className="btn btn-secondary" onClick={resetDashboard}>
                  ← New Image
                </button>
              )}
            </div>
          )}

          {/* Progress Stepper */}
          {loading && (
            <div className="progress-stepper" style={{ marginTop: '1.5rem' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Queue Execution Pipeline
              </h4>
              {steps.map((step, idx) => {
                const stepNum = idx + 1;
                let stepClass = 'step-item';
                if (currentStep === stepNum) stepClass += ' active';
                else if (currentStep > stepNum || currentStep === 5) stepClass += ' completed';
                return (
                  <div key={idx} className={stepClass}>
                    <div className="step-circle">
                      {currentStep > stepNum || currentStep === 5 ? '✓' : stepNum}
                    </div>
                    <div>
                      <div className="step-label">{step.label}</div>
                      <p style={{ fontSize: '0.75rem', marginTop: '0.1rem' }}>{step.desc}</p>
                    </div>
                  </div>
                );
              })}
              {currentStep === -1 && (
                <div style={{
                  color: 'var(--accent-error)', fontSize: '0.9rem', marginTop: '1rem',
                  textAlign: 'center', background: 'rgba(239,68,68,0.1)',
                  padding: '0.5rem', borderRadius: 'var(--radius-sm)'
                }}>
                  Queue Task Failed. Please try again.
                </div>
              )}
            </div>
          )}
        </div>

        {/* History Feed */}
        <div className="glass-card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={20} style={{ color: 'var(--accent-secondary)' }} />
            History Feed
          </h3>
          <div className="history-feed">
            {postsHistory.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
                No generation history yet.
              </p>
            ) : (
              postsHistory.slice(0, 5).map((post) => {
                const norm = normalisePost(post);
                const caption =
                  norm.content.variations?.[0]?.poeticCaption ||
                  norm.content.poeticCaption ||
                  'Processing...';
                return (
                  <div
                    key={post._id}
                    className="history-item glass-card"
                    onClick={() => loadPastPost(post)}
                  >
                    <img src={post.imageUrl} alt="thumbnail" className="history-thumb" />
                    <div className="history-details">
                      <div className="history-caption">{caption}</div>
                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.7rem' }}>
                        <span style={{
                          color: post.status === 'completed'
                            ? 'var(--accent-success)'
                            : 'var(--accent-warning)'
                        }}>
                          ● {post.status}
                        </span>
                        {norm.analytics.actualLikes > 0 && (
                          <span style={{ color: 'var(--text-secondary)' }}>
                            • {norm.analytics.actualLikes} likes
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="history-actions">
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                        onClick={(e) => { e.stopPropagation(); loadPastPost(post); }}
                      >
                        <Eye size={12} /> View
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Right Column: AI Outputs ── */}
      <div>
        <div className="glass-card" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={22} style={{ color: 'var(--accent-primary)' }} />
              AI Creative Outputs
            </h3>
            {currentPost && (
              <div className="card-title-badge">
                <TrendingUp size={14} />
                ML Prediction Engine Active
              </div>
            )}
          </div>

          {!currentPost ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              justifyContent: 'center', alignItems: 'center',
              color: 'var(--text-muted)', textAlign: 'center',
              padding: '4rem 2rem',
              border: '1px dashed var(--border-color)',
              borderRadius: 'var(--radius-md)'
            }}>
              <ImageIcon size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
              <h4>Upload and analyze an image to generate caption variations.</h4>
              <p style={{ fontSize: '0.85rem', maxWidth: '350px', marginTop: '0.5rem' }}>
                Our microservices will draft copy and rank variations based on audience prediction models.
              </p>
            </div>
          ) : (
            <div className="results-card" style={{ flex: 1 }}>

              {/* Mood Tags */}
              <div>
                <h4 style={{
                  fontSize: '0.85rem', textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.5rem'
                }}>
                  Semantic Mood Tags
                </h4>
                <div className="tags-list">
                  {moodTags.length > 0
                    ? moodTags.map((tag, idx) => (
                        <span key={idx} className="tag-badge">#{tag}</span>
                      ))
                    : <span style={{ fontStyle: 'italic', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        No tags available
                      </span>
                  }
                </div>
              </div>

              {/* Caption Variations */}
              <div>
                <h4 style={{
                  fontSize: '0.85rem', textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.75rem'
                }}>
                  Generated Caption Variations
                </h4>

                {variations.length === 0 ? (
                  <div style={{
                    padding: '2rem', textAlign: 'center',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-muted)', fontSize: '0.9rem'
                  }}>
                    No caption variations found for this post.
                  </div>
                ) : (
                  <div className="variations-list">
                    {variations.map((variation, idx) => (
                      <div key={idx} className={`variation-item ${variation.isBest ? 'best-match' : ''}`}>
                        {variation.isBest && <span className="best-badge">Audience Favorite</span>}
                        <div className="variation-caption">{variation.poeticCaption}</div>
                        <div className="variation-meta">
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {(variation.moodTags || []).map((t, i) => (
                              <span key={i} style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                #{t}{' '}
                              </span>
                            ))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <span className="variation-score">
                              Pred. Score: {variation.predictedScore}
                            </span>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)' }}
                              onClick={() => handleCopy(variation.poeticCaption, idx)}
                            >
                              {copiedIndex === idx
                                ? <Check size={14} style={{ color: 'var(--accent-success)' }} />
                                : <Copy size={14} />
                              }
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Publish / Engagement */}
              <div style={{
                marginTop: 'auto', paddingTop: '1.5rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', flexWrap: 'wrap', gap: '1rem'
              }}>
                <div>
                  {currentPost.analytics?.actualLikes > 0 ? (
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Actual Likes</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent-success)' }}>
                          {currentPost.analytics.actualLikes}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Actual Shares</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--accent-success)' }}>
                          {currentPost.analytics.actualShares}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '300px' }}>
                      Publish this post to simulate live user engagement data and populate analytics metrics.
                    </p>
                  )}
                </div>

                {isUnpublished && (
                  <button
                    className={`btn btn-primary ${publishing ? 'btn-disabled' : ''}`}
                    disabled={publishing}
                    onClick={handlePublish}
                  >
                    {publishing
                      ? <span className="pulse-spinner"></span>
                      : <><Send size={16} /> Publish & Simulate Engagement</>
                    }
                  </button>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}