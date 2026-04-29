import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Building2, Globe, PlusCircle, ShieldCheck, UserCircle2, Wallet } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';
import { clearOrgSession, getOrgId, getWalletAddress, setOrgSession } from '../session';

type TrustPayload = {
  level: string;
  twitter: boolean;
  website: boolean;
  kyc: boolean;
};

type WalletOrg = {
  id: string;
  name: string;
  walletAddress: string;
  status?: 'active' | 'delisted';
  delistedAt?: string | null;
  trust?: TrustPayload;
  auth: {
    orgId: string;
    apiKey: string;
  };
};

export const TrustOverview = () => {
  const navigate = useNavigate();
  const [trust, setTrust] = useState<TrustPayload | null>(null);
  const [walletOrgs, setWalletOrgs] = useState<WalletOrg[]>([]);
  const [expandedOrgId, setExpandedOrgId] = useState('');
  const [loading, setLoading] = useState(true);

  const walletAddress = getWalletAddress() || '';
  const activeOrgId = getOrgId() || '';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const orgRes = await api.org.listByWalletWithDelisted(walletAddress);
        const organizations = (orgRes.data?.organizations || []) as WalletOrg[];
        setWalletOrgs(organizations);

        if (organizations.length === 0) {
          clearOrgSession();
          setTrust(null);
          return;
        }

        const activeOrganizations = organizations.filter((org) => (org.status || 'active') !== 'delisted');
        const hasActive = activeOrganizations.some((org) => org.id === activeOrgId);
        if (!hasActive && activeOrganizations.length > 0) {
          setOrgSession(activeOrganizations[0].auth.orgId, activeOrganizations[0].auth.apiKey, activeOrganizations[0].name);
        }

        if (activeOrganizations.length > 0) {
          const trustRes = await api.org.getTrust();
          setTrust(trustRes.data?.trust ?? null);
        } else {
          clearOrgSession();
          setTrust(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (walletAddress) {
      load();
    } else {
      setLoading(false);
    }
  }, [walletAddress, activeOrgId]);

  const activeOrg = useMemo(() => walletOrgs.find((org) => org.id === (getOrgId() || '')), [walletOrgs]);

  const getColor = (level: string) => {
    switch (level) {
      case 'high':
        return 'text-green-400';
      case 'strong':
        return 'text-blue-400';
      case 'basic':
        return 'text-yellow-400';
      default:
        return 'text-gray-500';
    }
  };

  const switchOrg = async (org: WalletOrg) => {
    if ((org.status || 'active') === 'delisted') return;
    setOrgSession(org.auth.orgId, org.auth.apiKey, org.name);
    const trustRes = await api.org.getTrust();
    setTrust(trustRes.data?.trust ?? null);
  };

  const openOrgProfile = async (org: WalletOrg) => {
    if ((org.status || 'active') === 'delisted') return;
    await switchOrg(org);
    navigate('/org/profile');
  };

  const relistOrg = async (org: WalletOrg) => {
    setOrgSession(org.auth.orgId, org.auth.apiKey, org.name);
    await api.org.relist();
    const orgRes = await api.org.listByWalletWithDelisted(walletAddress);
    const organizations = (orgRes.data?.organizations || []) as WalletOrg[];
    setWalletOrgs(organizations);
    const next = organizations.find((item) => item.id === org.id) || organizations.find((item) => (item.status || 'active') !== 'delisted');
    if (next) {
      setOrgSession(next.auth.orgId, next.auth.apiKey, next.name);
      const trustRes = await api.org.getTrust();
      setTrust(trustRes.data?.trust ?? null);
    }
  };

  if (loading) return <div className="text-sm text-gray-400">Loading dashboard...</div>;

  if (!walletAddress) {
    return (
      <div className="page-shell">
        <NeoCard className="mx-auto w-full max-w-[680px] p-8 text-center">
          <h2 className="mb-3 inline-flex items-center gap-2 text-2xl font-semibold text-white">
            <Wallet className="h-6 w-6" />
            Wallet not connected
          </h2>
          <p className="mb-5 text-sm text-gray-400">Connect your wallet to continue.</p>
          <NeoButton onClick={() => navigate('/connect')} className="inline-flex items-center justify-center px-3" title="Connect">
            <Wallet className="h-4 w-4" />
          </NeoButton>
        </NeoCard>
      </div>
    );
  }

  if (walletOrgs.length === 0) {
    return (
      <div className="page-shell">
        <NeoCard className="mx-auto w-full max-w-[680px] p-8 text-center">
          <h2 className="mb-3 inline-flex items-center gap-2 text-2xl font-semibold text-white">
            <Building2 className="h-6 w-6" />
            No organizations yet
          </h2>
          <p className="mb-5 text-sm text-gray-400">Create one to start issuing credentials.</p>
          <NeoButton
            onClick={() => navigate('/org/register')}
            className="inline-flex items-center justify-center px-3"
            aria-label="Create organization"
            title="Create organization"
          >
            <PlusCircle className="h-4 w-4" />
          </NeoButton>
        </NeoCard>
      </div>
    );
  }

  return (
    <div className="page-shell page-stack">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Operations Dashboard</div>
            <h2 className="page-title">Monitor trust and switch active issuers</h2>
            <p className="page-subtitle">
              Review the current organization trust posture, jump into profile and verification, or activate another organization under the same wallet.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <ShieldCheck className="h-4 w-4 text-neo-accent" />
              <span>Current trust level</span>
            </div>
            <div className="mt-4 inline-flex items-center gap-2">
              <ShieldCheck className={`h-5 w-5 ${getColor(trust?.level || 'unverified')}`} />
              <h3 className={`text-2xl font-semibold ${getColor(trust?.level || 'unverified')}`}>
                {(trust?.level || 'unverified').toUpperCase()}
              </h3>
            </div>
            <p className="page-sidecopy">{activeOrg?.name || 'Unknown organization'}</p>
            <NeoButton
              variant="secondary"
              onClick={() => navigate('/org/register')}
              className="mt-6 inline-flex w-full items-center justify-center gap-2"
              aria-label="Create organization"
              title="Create organization"
            >
              <PlusCircle className="h-4 w-4" />
              Create Organization
            </NeoButton>
          </div>
        </div>
      </NeoCard>

      <div className="metric-grid">
        <div className="metric-card">
          <p className="inline-flex items-center gap-1.5 metric-label">
            <AtSign className="h-3.5 w-3.5" />
            Social
          </p>
          <span className={`metric-value ${trust?.twitter ? 'text-neo-accent' : 'text-gray-500'}`}>{trust?.twitter ? 'Verified' : 'Unverified'}</span>
        </div>
        <div className="metric-card">
          <p className="inline-flex items-center gap-1.5 metric-label">
            <Globe className="h-3.5 w-3.5" />
            Website
          </p>
          <span className={`metric-value ${trust?.website ? 'text-neo-accent' : 'text-gray-500'}`}>{trust?.website ? 'Verified' : 'Unverified'}</span>
        </div>
        <div className="metric-card">
          <p className="inline-flex items-center gap-1.5 metric-label">
            <ShieldCheck className="h-3.5 w-3.5" />
            KYC
          </p>
          <span className="metric-value text-gray-500">Disabled</span>
        </div>
      </div>

      <NeoCard className="p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="metric-label">Wallet Organizations</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Switch active organization</h3>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {walletOrgs.map((org) => {
            const active = org.id === (getOrgId() || '');
            const delisted = (org.status || 'active') === 'delisted';
            const expanded = expandedOrgId === org.id;
            return (
              <NeoCard
                key={org.id}
                className={`cursor-pointer p-4 transition ${delisted ? 'border-yellow-500/25 bg-[#17120a]/75' : (active ? 'border-neo-accent/20 bg-neo-accent/[0.06]' : 'bg-white/[0.03] hover:border-neo-accent/20')}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedOrgId(expanded ? '' : org.id)}
                  onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedOrgId(expanded ? '' : org.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-base font-medium text-white">{org.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-neo-accent/80">
                        {delisted ? 'DELISTED' : `Trust: ${(org.trust?.level || 'unverified').toUpperCase()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <NeoButton
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          void switchOrg(org);
                        }}
                        disabled={delisted}
                        className="inline-flex items-center justify-center px-3"
                        aria-label={`Use ${org.name}`}
                        title={`Use ${org.name}`}
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </NeoButton>
                      <NeoButton
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openOrgProfile(org);
                        }}
                        disabled={delisted}
                        className="inline-flex items-center justify-center px-3"
                        aria-label={`${org.name} profile`}
                        title={`${org.name} profile`}
                      >
                        <UserCircle2 className="h-4 w-4" />
                      </NeoButton>
                      {delisted ? (
                        <NeoButton
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            void relistOrg(org);
                          }}
                          className="inline-flex items-center justify-center px-3"
                          aria-label={`Relist ${org.name}`}
                          title={`Relist ${org.name}`}
                        >
                          Relist
                        </NeoButton>
                      ) : null}
                    </div>
                  </div>

                  {expanded ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      <div className="metric-card !rounded-[16px] !p-3">
                        <p className="metric-label">Social</p>
                        <p className={org.trust?.twitter ? 'mt-2 text-neo-accent' : 'mt-2 text-gray-500'}>
                          {org.trust?.twitter ? 'Verified' : 'Unverified'}
                        </p>
                      </div>
                      <div className="metric-card !rounded-[16px] !p-3">
                        <p className="metric-label">Website</p>
                        <p className={org.trust?.website ? 'mt-2 text-neo-accent' : 'mt-2 text-gray-500'}>
                          {org.trust?.website ? 'Verified' : 'Unverified'}
                        </p>
                      </div>
                      <div className="metric-card !rounded-[16px] !p-3 col-span-2 sm:col-span-1">
                        <p className="metric-label">KYC</p>
                        <p className={org.trust?.kyc ? 'mt-2 text-neo-accent' : 'mt-2 text-gray-500'}>
                          {org.trust?.kyc ? 'Verified' : 'Unverified'}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </NeoCard>
            );
          })}
        </div>
      </NeoCard>
    </div>
  );
};
