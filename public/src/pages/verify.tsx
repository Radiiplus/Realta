import { AlertTriangle, CheckCircle2, Circle, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';
import { getOrgId, getWalletAddress, setOrgSession } from '../session';

type EntityType = 'organization' | 'individual';

type WalletOrg = {
  id: string;
  name: string;
  entityType?: EntityType;
  profileLockedAt?: string | null;
  profile?: Record<string, string>;
  contactEmail?: string | null;
  auth: {
    orgId: string;
    apiKey: string;
  };
};

type RequiredCheck = {
  key: string;
  label: string;
  complete: boolean;
};

const requiredChecksForOrg = (org: WalletOrg): RequiredCheck[] => {
  const profile = org.profile || {};
  const entityType: EntityType = org.entityType === 'individual' ? 'individual' : 'organization';

  const common: RequiredCheck[] = [
    { key: 'name', label: 'Display Name', complete: Boolean((org.name || '').trim()) },
    { key: 'contactEmail', label: 'Contact Email', complete: Boolean((org.contactEmail || '').trim()) },
    { key: 'country', label: 'Country', complete: Boolean((profile.country || '').trim()) },
    { key: 'city', label: 'City', complete: Boolean((profile.city || '').trim()) },
    { key: 'addressLine', label: 'Address', complete: Boolean((profile.addressLine || '').trim()) },
    { key: 'website', label: 'Website', complete: Boolean((profile.website || '').trim()) },
  ];

  if (entityType === 'organization') {
    return [
      ...common,
      { key: 'legalName', label: 'Legal Name', complete: Boolean((profile.legalName || '').trim()) },
      { key: 'registrationNumber', label: 'Registration Number', complete: Boolean((profile.registrationNumber || '').trim()) },
      { key: 'industry', label: 'Industry', complete: Boolean((profile.industry || '').trim()) },
    ];
  }

  return [
    ...common,
    { key: 'firstName', label: 'First Name', complete: Boolean((profile.firstName || '').trim()) },
    { key: 'lastName', label: 'Last Name', complete: Boolean((profile.lastName || '').trim()) },
    { key: 'occupation', label: 'Occupation', complete: Boolean((profile.occupation || '').trim()) },
  ];
};

export const VerificationCenter = () => {
  const [orgs, setOrgs] = useState<WalletOrg[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [loading, setLoading] = useState(false);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const walletAddress = getWalletAddress() || '';
  const formatDateTime = (value?: string | null) => {
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

  const loadOrgs = async () => {
    if (!walletAddress) return;
    try {
      const res = await api.org.listByWallet(walletAddress);
      const organizations = (res.data?.organizations || []) as WalletOrg[];
      setOrgs(organizations);
      const currentOrgId = getOrgId() || '';
      const initial = organizations.find((o) => o.id === currentOrgId) || organizations[0];
      if (initial) {
        setSelectedOrgId(initial.id);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load organizations.');
    }
  };

  useEffect(() => {
    void loadOrgs();
  }, [walletAddress]);

  const selectedOrg = useMemo(() => orgs.find((org) => org.id === selectedOrgId) || null, [orgs, selectedOrgId]);
  const checks = useMemo(() => (selectedOrg ? requiredChecksForOrg(selectedOrg) : []), [selectedOrg]);
  const missingChecks = checks.filter((c) => !c.complete);
  const isProfileComplete = missingChecks.length === 0;
  const isLocked = Boolean(selectedOrg?.profileLockedAt);

  const pendingOrgs = useMemo(
    () => orgs.filter((org) => !org.profileLockedAt || !requiredChecksForOrg(org).every((c) => c.complete)),
    [orgs],
  );

  const selectOrg = (org: WalletOrg) => {
    setSelectedOrgId(org.id);
    setOrgSession(org.auth.orgId, org.auth.apiKey, org.name);
    setAgree(false);
    setError('');
    setSuccess('');
  };

  const handleVerifyAndLock = async () => {
    if (!selectedOrg || !isProfileComplete || !agree || isLocked) return;

    setOrgSession(selectedOrg.auth.orgId, selectedOrg.auth.apiKey, selectedOrg.name);
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.verification.attestProfile(true);
      setSuccess('Profile verified and locked successfully.');
      setAgree(false);
      await loadOrgs();
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.error || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell page-stack">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Verification Center</div>
            <h2 className="page-title">Lock identity data before issuing publicly</h2>
            <p className="page-subtitle">
              Verification here is profile attestation. Once locked, key issuer identity fields can no longer be changed.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <ShieldCheck className="h-4 w-4 text-neo-accent" />
              <span>Verification policy</span>
            </div>
            <p className="page-sidecopy">
              Complete all required profile fields, review the lock warning, and confirm the attestation. KYC remains disabled.
            </p>
          </div>
        </div>
      </NeoCard>

      {error ? <div className="error-card">{error}</div> : null}
      {success ? <div className="status-card">{success}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <NeoCard className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-300">Organizations Pending Verification</h3>
          <div className="space-y-2">
            {pendingOrgs.length === 0 ? (
              <div className="info-card text-sm text-gray-400">No pending organizations.</div>
            ) : (
              pendingOrgs.map((org) => {
                const active = org.id === selectedOrgId;
                const complete = requiredChecksForOrg(org).every((c) => c.complete);
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => selectOrg(org)}
                    className={`w-full rounded-[18px] border px-3 py-3 text-left text-sm transition ${
                      active ? 'border-neo-accent/30 bg-neo-accent/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-neo-accent/20'
                    }`}
                  >
                    <p className="font-medium text-white">{org.name}</p>
                    <p className="mt-1 text-xs text-gray-500">{complete ? 'Ready to verify?' : 'Profile incomplete.'}</p>
                  </button>
                );
              })
            )}
          </div>
        </NeoCard>

        <div className="space-y-4">
          <NeoCard className="p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-300">Required Profile Fields</h3>
            {!selectedOrg ? (
              <p className="text-sm text-gray-500">Select an organization to continue.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {checks.map((check) => (
                  <div key={check.key} className="metric-card !rounded-[18px] !p-3 text-xs">
                    <p className="inline-flex items-center gap-1.5">
                      {check.complete ? <CheckCircle2 className="h-3.5 w-3.5 text-neo-accent" /> : <Circle className="h-3.5 w-3.5 text-gray-500" />}
                      <span className={check.complete ? 'text-neo-accent' : 'text-gray-500'}>{check.label}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </NeoCard>

          <NeoCard className="p-5">
            {!selectedOrg ? (
              <p className="text-sm text-gray-500">Select an organization to begin verification.</p>
            ) : isLocked ? (
              <div className="status-card text-sm">
                <p className="inline-flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Profile verified and locked at {formatDateTime(selectedOrg.profileLockedAt)}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {!isProfileComplete ? (
                  <div className="rounded-[18px] border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                    Complete required profile fields before verification.
                  </div>
                ) : null}

                <label className="flex items-start gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I confirm this profile information is correct and understand it will be permanently locked after verification.
                  </span>
                </label>

                <NeoButton onClick={handleVerifyAndLock} loading={loading} disabled={!isProfileComplete || !agree || isLocked}>
                  Verify and Lock Profile
                </NeoButton>
              </div>
            )}
          </NeoCard>

          <NeoCard className="border-neo-danger/20 p-5">
            <h3 className="mb-2 inline-flex items-center gap-2 font-bold text-neo-danger">
              <AlertTriangle className="h-4 w-4" />
              KYC Verification
            </h3>
            <p className="text-gray-500">Temporarily disabled due to regulatory updates.</p>
          </NeoCard>
        </div>
      </div>
    </div>
  );
};
