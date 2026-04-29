import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { NeoCard } from '../components/neocard';
import { NeoButton } from '../components/button';
import { NeoInput } from '../components/input';
import { buildIssuanceClaimMessage, sha256Hex } from '../lib/platformauth';
import { connectJoyId, signJoyIdChallenge } from '../lib/joyid';
import { getWalletAddress, getWalletPublicKey, setWalletSession } from '../session';

type PublicIssuanceSession = {
  id: string;
  orgId: string;
  orgName?: string | null;
  credentialType: string;
  credentialTitle?: string | null;
  note?: string | null;
  nonce: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export const IssuanceSessionPage = () => {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [session, setSession] = useState<PublicIssuanceSession | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [reference, setReference] = useState('');
  const [walletAddress, setWalletAddress] = useState(getWalletAddress() || '');

  const sessionExpired = useMemo(() => {
    if (!session?.expiresAt) return true;
    return Date.now() > Date.parse(session.expiresAt);
  }, [session]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.issuanceSession.getPublic(token);
        setSession(res.data?.session || null);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to load session.');
      } finally {
        setLoading(false);
      }
    };
    if (token) void load();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!session) {
      setError('Session is unavailable.');
      return;
    }
    if (sessionExpired || session.status === 'expired') {
      setError('This session has expired.');
      return;
    }
    if (session.status === 'submitted') {
      setError('This session was already completed.');
      return;
    }
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }

    setSubmitting(true);
    try {
      let linkedWallet = String(getWalletAddress() || '').trim();
      let linkedPublicKey = String(getWalletPublicKey() || '').trim().toLowerCase();
      if (!linkedWallet) {
        const joy = await connectJoyId();
        linkedWallet = joy.address;
        linkedPublicKey = (joy.publicKey || '').toLowerCase();
        setWalletSession(linkedWallet, undefined, {
          provider: 'joyid',
          publicKey: linkedPublicKey || undefined,
        });
      }

      const issuedAt = new Date().toISOString();
      const message = buildIssuanceClaimMessage({
        sessionId: session.id,
        orgId: session.orgId,
        credentialType: session.credentialType,
        nonce: session.nonce,
        walletAddress: linkedWallet,
        fullName: fullName.trim(),
        email: email.trim(),
        reference: reference.trim(),
        issuedAt,
      });
      const digestHex = await sha256Hex(message);
      const proof = await signJoyIdChallenge(digestHex);
      const publicKey = String(proof.publicKey || linkedPublicKey || '').toLowerCase();
      if (!publicKey) {
        throw new Error('JoyID did not provide a public key for this signature.');
      }

      await api.issuanceSession.submitUser({
        token,
        walletAddress: linkedWallet,
        publicKey,
        signature: proof.signature,
        issuedAt,
        profile: {
          fullName: fullName.trim(),
          email: email.trim(),
          reference: reference.trim(),
        },
      });
      setWalletAddress(linkedWallet);
      setSuccess('Identity sent to issuing organization successfully.');
      setSession((prev) => (prev ? { ...prev, status: 'submitted' } : prev));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit identity.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="page-shell pt-10 text-sm text-gray-400">Loading session...</div>;
  }

  return (
    <div className="page-shell page-stack px-4">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Claimant Authorization</div>
            <h1 className="page-title">Sign once to share identity with the issuer</h1>
            <p className="page-subtitle">
              This short-lived session lets you approve one credential issuance request using JoyID without creating a full account.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <ShieldCheck className="h-4 w-4 text-neo-accent" />
              <span>Session details</span>
            </div>
            {session ? (
              <div className="mt-4 space-y-2 text-sm text-[#9eb1a8]">
                <p>Org: {session.orgName || session.orgId}</p>
                <p>Credential Type: {session.credentialType}</p>
                <p>Credential Title: {session.credentialTitle || 'Not specified'}</p>
                <p>Expires: {new Date(session.expiresAt).toLocaleString()}</p>
                <p>Status: {sessionExpired ? 'expired' : session.status}</p>
                {session.note ? <p>Note: {session.note}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </NeoCard>

      {error ? <div className="error-card">{error}</div> : null}
      {success ? (
        <div className="status-card">
          <p className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{success}</p>
          {walletAddress ? <p className="mt-1 text-xs text-emerald-200/90">Linked wallet: {walletAddress}</p> : null}
        </div>
      ) : null}

      <NeoCard className="p-6">
        <form onSubmit={handleSubmit} className="space-y-3">
          <NeoInput
            label="Full Name"
            placeholder="Your legal/full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <NeoInput
            label="Email (Optional)"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <NeoInput
            label="Reference (Optional)"
            placeholder="Student ID / Staff ID / Wallet alias"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <NeoButton
            type="submit"
            loading={submitting}
            disabled={!session || sessionExpired || session.status === 'submitted'}
            className="inline-flex w-full items-center justify-center gap-2"
          >
            <KeyRound className="h-4 w-4" />
            Connect JoyID & Share Identity
          </NeoButton>
        </form>
      </NeoCard>
    </div>
  );
};
