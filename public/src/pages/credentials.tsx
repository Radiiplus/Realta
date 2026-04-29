import { CheckCircle2, Clock3, Link2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';

type CredentialRecord = {
  id: string;
  title: string;
  status: string;
  recipientDisplayName?: string | null;
  network?: string;
  ndcpOutPoint?: {
    txHash?: string;
    index?: string;
  };
  onChain?: {
    revoked?: boolean;
    contentHash?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

const formatDateTime = (value?: string) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
};

export const CredentialListPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [items, setItems] = useState<CredentialRecord[]>([]);
  const [workingId, setWorkingId] = useState('');

  const loadCredentials = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.credential.list();
      const records = (res.data?.credentials || []) as CredentialRecord[];
      setItems(records);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load credentials.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCredentials();
  }, []);

  const toggleDelist = async (credential: CredentialRecord) => {
    setWorkingId(credential.id);
    setError('');
    setNotice('');
    try {
      const status = String(credential.status || '').toLowerCase();
      if (status === 'delisted') {
        await api.credential.undelistRecord(credential.id);
      } else {
        await api.credential.delistRecord(credential.id);
      }
      await loadCredentials();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to update credential status.');
    } finally {
      setWorkingId('');
    }
  };

  const shareCredential = async (credential: CredentialRecord) => {
    setWorkingId(credential.id);
    setError('');
    setNotice('');
    try {
      const res = await api.credential.shareLink(credential.id);
      const shareUrl = String(res?.data?.identityUrl || res?.data?.shareUrl || '').trim();
      if (!shareUrl) throw new Error('Share URL was not returned.');
      await navigator.clipboard.writeText(shareUrl);
      setNotice(`Copied share URL: ${shareUrl}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create share URL.');
    } finally {
      setWorkingId('');
    }
  };

  const embedCredential = async (credential: CredentialRecord) => {
    setWorkingId(credential.id);
    setError('');
    setNotice('');
    try {
      const res = await api.credential.shareLink(credential.id);
      const iframeCode = String(res?.data?.iframeCode || '').trim();
      if (!iframeCode) throw new Error('Embed iframe code was not returned.');
      await navigator.clipboard.writeText(iframeCode);
      setNotice(`Copied iframe embed code for credential ${credential.id}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create embed code.');
    } finally {
      setWorkingId('');
    }
  };

  return (
    <div className="page-shell page-stack">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Issued Records</div>
            <h2 className="page-title">Manage published credentials and public share access</h2>
            <p className="page-subtitle">
              Inspect on-chain metadata, copy share or embed links, and delist records when they should no longer appear publicly.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <Link2 className="h-4 w-4 text-neo-accent" />
              <span>Credential actions</span>
            </div>
            <p className="page-sidecopy">
              Share copies the public URL, Embed copies iframe markup, and Delist hides the record without deleting on-chain history.
            </p>
          </div>
        </div>
      </NeoCard>

      {error ? <div className="error-card">{error}</div> : null}
      {notice ? <div className="status-card">{notice}</div> : null}
      {loading ? (
        <NeoCard className="p-5">
          <p className="inline-flex items-center gap-2 text-gray-400">
            <Clock3 className="h-4 w-4" />
            Loading credentials...
          </p>
        </NeoCard>
      ) : null}

      {!loading && items.length === 0 ? (
        <NeoCard className="p-5">
          <p className="text-gray-400">No linked credentials yet.</p>
        </NeoCard>
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="grid gap-3">
          {items.map((credential) => {
            const isRevoked = String(credential.status || '').toLowerCase() === 'revoked';
            const isDelisted = String(credential.status || '').toLowerCase() === 'delisted';
            const statusClass = isDelisted ? 'text-yellow-300' : (isRevoked ? 'text-red-300' : 'text-neo-accent');
            const StatusIcon = isDelisted ? Clock3 : (isRevoked ? ShieldAlert : CheckCircle2);
            return (
              <NeoCard key={credential.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{credential.title || 'Credential'}</h3>
                    <p className="mt-1 text-sm text-gray-400">
                      Recipient: {credential.recipientDisplayName || 'N/A'}
                    </p>
                  </div>
                  <p className={`inline-flex items-center gap-1 text-sm ${statusClass}`}>
                    <StatusIcon className="h-4 w-4" />
                    {credential.status || 'unknown'}
                  </p>
                </div>

                <div className="mt-4 metric-grid">
                  <div className="metric-card !rounded-[18px] !p-3">
                    <span className="metric-label">ID</span>
                    <span className="metric-value break-all">{credential.id}</span>
                  </div>
                  <div className="metric-card !rounded-[18px] !p-3">
                    <span className="metric-label">Network</span>
                    <span className="metric-value">{credential.network || 'devnet'}</span>
                  </div>
                  <div className="metric-card !rounded-[18px] !p-3">
                    <span className="metric-label">Created</span>
                    <span className="metric-value">{formatDateTime(credential.createdAt)}</span>
                  </div>
                  <div className="metric-card !rounded-[18px] !p-3">
                    <span className="metric-label">Updated</span>
                    <span className="metric-value">{formatDateTime(credential.updatedAt)}</span>
                  </div>
                  <div className="metric-card !rounded-[18px] !p-3 sm:col-span-2">
                    <span className="inline-flex items-center gap-1 metric-label">
                      <Link2 className="h-3.5 w-3.5" />
                      OutPoint
                    </span>
                    <span className="metric-value break-all">{credential.ndcpOutPoint?.txHash || 'N/A'}:{credential.ndcpOutPoint?.index || 'N/A'}</span>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <NeoButton
                    variant="secondary"
                    onClick={() => void embedCredential(credential)}
                    loading={workingId === credential.id}
                    className="inline-flex items-center justify-center px-3"
                    aria-label={`Embed ${credential.title || credential.id}`}
                    title="Copy iframe embed code"
                  >
                    Embed
                  </NeoButton>
                  <NeoButton
                    variant="secondary"
                    onClick={() => void shareCredential(credential)}
                    loading={workingId === credential.id}
                    className="inline-flex items-center justify-center px-3"
                    aria-label={`Share ${credential.title || credential.id}`}
                    title="Copy public share URL"
                  >
                    Share
                  </NeoButton>
                  <NeoButton
                    variant="secondary"
                    onClick={() => void toggleDelist(credential)}
                    loading={workingId === credential.id}
                    className="inline-flex items-center justify-center px-3"
                    aria-label={isDelisted ? `Restore ${credential.title || credential.id}` : `Delist ${credential.title || credential.id}`}
                    title={isDelisted ? 'Restore credential' : 'Delist credential'}
                  >
                    {isDelisted ? 'Restore' : 'Delist'}
                  </NeoButton>
                </div>
              </NeoCard>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
