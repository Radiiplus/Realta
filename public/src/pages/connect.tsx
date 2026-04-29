import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Fingerprint, PlugZap, Wallet } from 'lucide-react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';
import { NeoInput } from '../components/input';
import { getWalletAddress, setOrgSession, setWalletSession } from '../session';
import { connectJoyId } from '../lib/joyid';

type WalletOrg = {
  id: string;
  name: string;
  walletAddress: string;
  trust?: { level?: string };
  auth: {
    orgId: string;
    apiKey: string;
  };
};

export const ConnectWallet = () => {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<WalletOrg[]>([]);
  const [walletAddress, setWalletAddress] = useState(getWalletAddress() || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [walletLabelInput, setWalletLabelInput] = useState('');
  const [pendingWalletAddress, setPendingWalletAddress] = useState('');
  const [pendingPublicKey, setPendingPublicKey] = useState('');

  useEffect(() => {
    const loadOrganizations = async () => {
      if (!walletAddress) return;
      try {
        const res = await api.org.listByWallet(walletAddress);
        const organizations = (res.data?.organizations || []) as WalletOrg[];
        setOrgs(organizations);
      } catch (err) {
        console.error(err);
      }
    };
    void loadOrganizations();
  }, [walletAddress]);

  const handleConnect = async () => {
    setError('');
    setLoading(true);
    try {
      const joy = await connectJoyId();
      const walletAddressValue = joy.address;
      const publicKey = joy.publicKey || '';
      const res = await api.org.listByWallet(walletAddressValue);
      const organizations = (res.data?.organizations || []) as WalletOrg[];

      setWalletSession(walletAddressValue, 'JoyID Wallet', {
        provider: 'joyid',
        publicKey: publicKey || undefined,
      });
      setWalletAddress(walletAddressValue);

      if (organizations.length === 0) {
        setPendingWalletAddress(walletAddressValue);
        setPendingPublicKey(publicKey);
        setShowLabelModal(true);
      }

      setOrgs(organizations);
      if (organizations.length === 1) {
        setOrgSession(organizations[0].auth.orgId, organizations[0].auth.apiKey, organizations[0].name);
        navigate('/');
      }
    } catch (err) {
      console.error(err);
      setError('Unable to connect JoyID wallet or fetch organizations.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmWalletLabel = () => {
    const label = walletLabelInput.trim() || 'JoyID Wallet';
    if (!pendingWalletAddress) return;
    setWalletSession(pendingWalletAddress, label, {
      provider: 'joyid',
      publicKey: pendingPublicKey || undefined,
    });
    setWalletAddress(pendingWalletAddress);
    setShowLabelModal(false);
    setPendingWalletAddress('');
    setPendingPublicKey('');
    setWalletLabelInput('');
  };

  const selectOrganization = (org: WalletOrg) => {
    setOrgSession(org.auth.orgId, org.auth.apiKey, org.name);
    navigate('/');
  };

  const createOrganization = () => {
    navigate('/org/register');
  };

  const skipOrganizationCreation = () => {
    setShowLabelModal(false);
    setPendingWalletAddress('');
    setPendingPublicKey('');
    setWalletLabelInput('');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(0,255,157,0.16),transparent_28%),radial-gradient(circle_at_right_20%,rgba(0,136,255,0.18),transparent_32%),linear-gradient(145deg,#04110d_0%,#06151f_44%,#020406_100%)] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1180px]">
        {!walletAddress ? (
          <NeoCard className="border-white/15 bg-[#04080a]/75 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)] md:p-7">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div>
                <div className="inline-flex items-center rounded-full border border-neo-accent/25 bg-neo-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-neo-accent">
                  Identity Control
                </div>
                <h1 className="mt-5 text-4xl font-semibold leading-none tracking-[-0.06em] text-white md:text-6xl">
                  Connect your JoyID wallet to enter Realta
                </h1>
                <p className="mt-4 max-w-[62ch] text-sm text-[#9eb1a8] md:text-base">
                  This portal binds wallet identity to organization access. Connect first, then continue with an existing organization or create a new one.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                    <Wallet className="h-4 w-4 text-neo-accent" />
                    <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[#8ca198]">Wallet</p>
                    <p className="mt-2 text-sm text-white">JoyID direct connect</p>
                  </div>
                  <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                    <Fingerprint className="h-4 w-4 text-neo-accent" />
                    <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[#8ca198]">Access</p>
                    <p className="mt-2 text-sm text-white">Session stored in cookies</p>
                  </div>
                  <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                    <CheckCircle2 className="h-4 w-4 text-neo-accent" />
                    <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[#8ca198]">Flow</p>
                    <p className="mt-2 text-sm text-white">Open org or create one</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/15 bg-[linear-gradient(180deg,rgba(10,20,17,0.92),rgba(4,9,12,0.88))] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="inline-flex items-center gap-2 text-sm text-white">
                  <Wallet className="h-4 w-4 text-neo-accent" />
                  Wallet Connection
                </div>
                <p className="mt-4 text-sm text-[#8ca198]">
                  Open JoyID and approve the connection request to continue.
                </p>
                {error ? (
                  <div className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}
                <NeoButton
                  onClick={() => void handleConnect()}
                  loading={loading}
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 px-5"
                  aria-label="Connect JoyID wallet"
                  title="Connect JoyID wallet"
                >
                  <PlugZap className="h-4 w-4" />
                  Connect JoyID
                </NeoButton>
              </div>
            </div>
          </NeoCard>
        ) : (
          <NeoCard className="border-white/15 bg-[#04080a]/75 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)] md:p-7">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <div>
                <div className="inline-flex items-center rounded-full border border-neo-accent/25 bg-neo-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-neo-accent">
                  Connected Wallet
                </div>
                <h2 className="mt-5 text-4xl font-semibold leading-none tracking-[-0.06em] text-white md:text-5xl">
                  {orgs.length === 0 ? 'Create organization or skip for now' : 'Select an organization'}
                </h2>
                <p className="mt-4 max-w-[62ch] break-all text-sm text-[#9eb1a8] md:text-base">{walletAddress}</p>
              </div>

              <div className="rounded-[22px] border border-white/15 bg-[linear-gradient(180deg,rgba(10,20,17,0.92),rgba(4,9,12,0.88))] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="inline-flex items-center gap-2 text-sm text-white">
                  <Building2 className="h-4 w-4 text-neo-accent" />
                  Next Step
                </div>
                <p className="mt-4 text-sm text-[#8ca198]">
                  {orgs.length === 0
                    ? 'This wallet has no linked organization profile yet.'
                    : 'Choose which organization to activate for this session.'}
                </p>
                <NeoButton
                  variant="secondary"
                  onClick={createOrganization}
                  className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 px-3"
                  aria-label="Create organization"
                  title="Create organization"
                >
                  <Building2 className="h-4 w-4" />
                  Create Organization
                </NeoButton>
              </div>
            </div>

            {error ? (
              <div className="mt-6 w-full rounded-[18px] border border-neo-danger/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            {orgs.length === 0 ? (
              <div className="mt-6 flex min-w-[320px] flex-col items-center rounded-[22px] border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-gray-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-[18px] border border-neo-accent/35 bg-[#0a1210]">
                  <Building2 className="h-6 w-6 text-neo-accent" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white">No organizations found</h3>
                <p className="mt-2 max-w-[26rem] text-[#8ca198]">
                  This wallet is connected, but it does not have an organization profile yet. Create one to continue.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <NeoButton
                    onClick={createOrganization}
                    className="inline-flex items-center justify-center gap-2 px-4"
                    aria-label="Create organization"
                    title="Create organization"
                  >
                    <Building2 className="h-4 w-4" />
                    Create Organization
                  </NeoButton>
                  <NeoButton
                    variant="secondary"
                    onClick={skipOrganizationCreation}
                    className="inline-flex items-center justify-center px-4"
                    aria-label="Skip organization creation"
                    title="Skip organization creation"
                  >
                    Skip for now
                  </NeoButton>
                </div>
              </div>
            ) : (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {orgs.map((org) => (
                  <NeoCard key={org.id} className="border-white/10 bg-white/[0.03] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                    <h3 className="text-base font-medium text-white">{org.name}</h3>
                    <p className="mt-1 text-xs uppercase tracking-wide text-neo-accent/80">
                      Trust: {org.trust?.level || 'unverified'}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <NeoButton
                        variant="secondary"
                        onClick={() => selectOrganization(org)}
                        className="inline-flex items-center justify-center px-3"
                        aria-label={`Open ${org.name}`}
                        title={`Open ${org.name}`}
                      >
                        Open
                      </NeoButton>
                    </div>
                  </NeoCard>
                ))}
              </div>
            )}
          </NeoCard>
        )}
      </div>

      {showLabelModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <NeoCard className="w-full max-w-[420px] border-white/20 p-5">
            <h3 className="text-lg font-semibold text-white">Name This Wallet</h3>
            <p className="mt-1 text-sm text-gray-400">No organization was found for this wallet. Give it a label first.</p>
            <NeoInput
              label="Wallet Name"
              placeholder="e.g. Primary JoyID Wallet"
              value={walletLabelInput}
              onChange={(e) => setWalletLabelInput(e.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <NeoButton
                variant="secondary"
                onClick={() => {
                  setShowLabelModal(false);
                  setWalletLabelInput('');
                  setPendingWalletAddress('');
                  setPendingPublicKey('');
                }}
              >
                Cancel
              </NeoButton>
              <NeoButton variant="secondary" onClick={skipOrganizationCreation}>
                Skip for now
              </NeoButton>
              <NeoButton onClick={handleConfirmWalletLabel}>Save</NeoButton>
            </div>
          </NeoCard>
        </div>
      ) : null}
    </div>
  );
};
