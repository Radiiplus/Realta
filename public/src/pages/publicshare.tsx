import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NeoCard } from '../components/neocard';
import { api } from '../api';

type SharePayload = {
  credentialId: string;
  title?: string;
  status?: string;
  recipientDisplayName?: string;
  orgId?: string;
  orgShareSlug?: string | null;
  claimant?: {
    fullName?: string | null;
    reference?: string | null;
  } | null;
  issuer?: { name?: string; website?: string; socialPlatform?: string; socialHandle?: string } | null;
  trust?: { score?: number; level?: string } | null;
  network?: string;
  ndcpOutPoint?: { txHash?: string; index?: string | number } | null;
  createdAt?: string;
  updatedAt?: string;
};

function formatDate(value?: string) {
  if (!value) return 'N/A';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

export function PublicSharePage() {
  const { slug, id } = useParams<{ slug?: string; id?: string }>();
  const shareSlug = String(slug || id || '').trim();
  const [data, setData] = useState<SharePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!shareSlug) {
        setError('Missing share slug.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const res = await api.credential.shareGet(shareSlug);
        if (!cancelled) setData((res.data || null) as SharePayload);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.error || 'Share link not found.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [shareSlug]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(0,255,157,0.16),transparent_28%),radial-gradient(circle_at_right_20%,rgba(0,136,255,0.18),transparent_32%),linear-gradient(145deg,#04110d_0%,#06151f_44%,#020406_100%)] px-4 py-10 text-gray-100">
      <div className="mx-auto w-full max-w-4xl">
        <NeoCard className="p-6 md:p-8">
          <div className="page-kicker">Public Verification</div>
          <h1 className="mt-4 text-4xl font-semibold leading-none tracking-[-0.06em] text-white">Credential verification record</h1>
          <p className="mt-3 text-sm text-[#9eb1a8]">Share slug: {shareSlug || 'N/A'}</p>

          {loading ? (
            <p className="mt-6 text-sm text-gray-300">Loading credential...</p>
          ) : null}

          {!loading && error ? (
            <p className="mt-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>
          ) : null}

          {!loading && !error && data ? (
            <div className="mt-6 page-stack">
              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-label">Credential ID</span>
                  <span className="metric-value break-all">{data.credentialId || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Title</span>
                  <span className="metric-value">{data.title || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Status</span>
                  <span className="metric-value">{data.status || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Recipient</span>
                  <span className="metric-value">{data.recipientDisplayName || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Issuer</span>
                  <span className="metric-value">{data.issuer?.name || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Trust</span>
                  <span className="metric-value">{data.trust?.level || 'N/A'} ({data.trust?.score ?? 0})</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Network</span>
                  <span className="metric-value">{data.network || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">OutPoint</span>
                  <span className="metric-value break-all">{data.ndcpOutPoint?.txHash || 'N/A'}:{String(data.ndcpOutPoint?.index ?? 'N/A')}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Created</span>
                  <span className="metric-value">{formatDate(data.createdAt)}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Updated</span>
                  <span className="metric-value">{formatDate(data.updatedAt)}</span>
                </div>
              </div>
              {shareSlug ? <p><Link className="text-neo-accent underline" to={`/public/id/${encodeURIComponent(shareSlug)}`}>Open holder ID card</Link></p> : null}
              {data.orgShareSlug ? <p><Link className="text-neo-accent underline" to={`/public/org/${encodeURIComponent(data.orgShareSlug)}`}>Open organization card</Link></p> : null}
            </div>
          ) : null}
        </NeoCard>
      </div>
    </div>
  );
}
