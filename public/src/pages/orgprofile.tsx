import { useEffect, useState } from 'react';
import { Building2, Edit, Save, Share2, ShieldOff, UserCircle2, X } from 'lucide-react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';
import { NeoInput } from '../components/input';
import { clearOrgSession, getOrgId } from '../session';
import { useNavigate } from 'react-router-dom';
import { SOCIAL_PLATFORM_OPTIONS, socialHandlePlaceholder, socialPlatformLabel } from '../social';

type EntityType = 'organization' | 'individual';

type OrgProfileForm = {
  entityType: EntityType;
  profileLockedAt: string;
  name: string;
  contactEmail: string;
  phone: string;
  country: string;
  city: string;
  addressLine: string;
  website: string;
  socialPlatform: string;
  socialHandle: string;
  description: string;
  legalName: string;
  registrationNumber: string;
  industry: string;
  firstName: string;
  lastName: string;
  occupation: string;
};

const EMPTY_FORM: OrgProfileForm = {
  entityType: 'organization',
  profileLockedAt: '',
  name: '',
  contactEmail: '',
  phone: '',
  country: '',
  city: '',
  addressLine: '',
  website: '',
  socialPlatform: 'x',
  socialHandle: '',
  description: '',
  legalName: '',
  registrationNumber: '',
  industry: '',
  firstName: '',
  lastName: '',
  occupation: '',
};

export const OrganizationProfile = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delisting, setDelisting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<OrgProfileForm>(EMPTY_FORM);
  const [orgStatus, setOrgStatus] = useState<'active' | 'delisted'>('active');
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

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const orgId = getOrgId() || '';
      if (!orgId) {
        setError('No active organization in session.');
        return;
      }
      const res = await api.org.get(orgId);
      const org = res.data?.organization || {};
      const profile = org.profile || {};

      setForm({
        entityType: (org.entityType === 'individual' ? 'individual' : 'organization') as EntityType,
        profileLockedAt: String(org.profileLockedAt || ''),
        name: String(org.name || ''),
        contactEmail: String(org.contactEmail || ''),
        phone: String(profile.phone || ''),
        country: String(profile.country || ''),
        city: String(profile.city || ''),
        addressLine: String(profile.addressLine || ''),
        website: String(profile.website || ''),
        socialPlatform: String(profile.socialPlatform || (profile.twitter ? 'x' : 'x')),
        socialHandle: String(profile.socialHandle || profile.twitter || ''),
        description: String(profile.description || ''),
        legalName: String(profile.legalName || ''),
        registrationNumber: String(profile.registrationNumber || ''),
        industry: String(profile.industry || ''),
        firstName: String(profile.firstName || ''),
        lastName: String(profile.lastName || ''),
        occupation: String(profile.occupation || ''),
      });
      setOrgStatus(org.status === 'delisted' ? 'delisted' : 'active');
    } catch (err) {
      console.error(err);
      setError('Failed to load organization profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelistOrg = async () => {
    setDelisting(true);
    setError('');
    setSuccess('');
    try {
      await api.org.delist();
      clearOrgSession();
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delist organization.');
    } finally {
      setDelisting(false);
    }
  };

  const handleShareOrg = async () => {
    setSharing(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.org.shareLink();
      const shareUrl = String(res?.data?.shareUrl || '').trim();
      if (!shareUrl) throw new Error('Share URL was not returned.');
      await navigator.clipboard.writeText(shareUrl);
      setSuccess(`Copied organization share URL: ${shareUrl}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create org share URL.');
    } finally {
      setSharing(false);
    }
  };

  const handleEmbedOrg = async () => {
    setSharing(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.org.shareLink();
      const iframeCode = String(res?.data?.iframeCode || '').trim();
      if (!iframeCode) throw new Error('Embed iframe code was not returned.');
      await navigator.clipboard.writeText(iframeCode);
      setSuccess('Copied organization iframe embed code.');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create org embed code.');
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setField = (key: keyof OrgProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess('');
    setError('');

    if (form.profileLockedAt) {
      setError('Profile is locked and can no longer be edited.');
      return;
    }

    if (!form.name.trim()) {
      setError('Display name is required.');
      return;
    }

    if (form.entityType === 'organization' && !form.legalName.trim()) {
      setError('Legal name is required for organizations.');
      return;
    }

    if (form.entityType === 'individual' && (!form.firstName.trim() || !form.lastName.trim())) {
      setError('First name and last name are required for individuals.');
      return;
    }

    if (!form.contactEmail.trim() || !form.country.trim() || !form.city.trim() || !form.addressLine.trim() || !form.website.trim()) {
      setError('Email, country, city, address, and website are required.');
      return;
    }

    if (form.entityType === 'organization' && !form.industry.trim()) {
      setError('Industry is required for organizations.');
      return;
    }

    if (form.entityType === 'individual' && !form.occupation.trim()) {
      setError('Occupation is required for individuals.');
      return;
    }

    setSaving(true);
    try {
      await api.org.update({
        name: form.name,
        contactEmail: form.contactEmail,
        phone: form.phone,
        country: form.country,
        city: form.city,
        addressLine: form.addressLine,
        website: form.website,
        socialPlatform: form.socialPlatform,
        socialHandle: form.socialHandle,
        description: form.description,
        legalName: form.legalName,
        industry: form.industry,
        firstName: form.firstName,
        lastName: form.lastName,
        occupation: form.occupation,
      });
      setSuccess('Profile updated.');
      setIsEditing(false);
      await load();
    } catch (err) {
      console.error(err);
      setError('Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-400">Loading profile...</div>;

  return (
    <div className="page-shell page-stack overflow-x-hidden px-3 sm:px-1">
      <NeoCard className="min-w-0 p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Issuer Profile</div>
            <h2 className="page-title">Maintain the public identity behind this issuer</h2>
            <p className="page-subtitle">
              This record powers trust, issuer cards, and issuance metadata. Once verified and locked, core profile fields stop being editable.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              {form.entityType === 'organization' ? <Building2 className="h-4 w-4 text-neo-accent" /> : <UserCircle2 className="h-4 w-4 text-neo-accent" />}
              <span>{form.entityType === 'organization' ? 'Organization profile' : 'Individual profile'}</span>
            </div>
            <p className="mt-4 text-sm text-[#8ca198]">
              {form.profileLockedAt
                ? `Verified and locked at ${formatDateTime(form.profileLockedAt)}`
                : 'Editable until verification locks the profile.'}
            </p>
            <p className="mt-3 inline-flex items-center gap-1 text-xs text-gray-500">
              <ShieldOff className="h-3.5 w-3.5" />
              KYC disabled
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {isEditing ? (
            <div className="flex gap-2">
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => void handleShareOrg()}
                loading={sharing}
                className="inline-flex items-center justify-center px-3"
                aria-label="Share organization"
                title="Copy public organization URL"
              >
                <Share2 className="h-4 w-4" />
                <span className="ml-1">Share Org</span>
              </NeoButton>
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => void handleEmbedOrg()}
                loading={sharing}
                className="inline-flex items-center justify-center px-3"
                aria-label="Embed organization card"
                title="Copy organization iframe embed code"
              >
                Embed Org
              </NeoButton>
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center justify-center px-3"
                aria-label="Cancel edit"
                title="Cancel edit"
              >
                <X className="h-4 w-4" />
              </NeoButton>
            </div>
          ) : (
            <div className="flex gap-2">
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => void handleShareOrg()}
                loading={sharing}
                className="inline-flex items-center justify-center px-3"
                aria-label="Share organization"
                title="Copy public organization URL"
              >
                <Share2 className="h-4 w-4" />
                <span className="ml-1">Share Org</span>
              </NeoButton>
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => void handleEmbedOrg()}
                loading={sharing}
                className="inline-flex items-center justify-center px-3"
                aria-label="Embed organization card"
                title="Copy organization iframe embed code"
              >
                Embed Org
              </NeoButton>
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setError('');
                  setSuccess('');
                  setIsEditing(true);
                }}
                disabled={Boolean(form.profileLockedAt) || orgStatus === 'delisted'}
                className="inline-flex items-center justify-center px-3"
                aria-label="Edit profile"
                title="Edit profile"
              >
                <Edit className="h-4 w-4" />
              </NeoButton>
              <NeoButton
                type="button"
                variant="danger"
                onClick={() => void handleDelistOrg()}
                loading={delisting}
                disabled={orgStatus === 'delisted'}
                className="inline-flex items-center justify-center px-3"
                aria-label="Delist organization"
                title="Delist organization"
              >
                Delist
              </NeoButton>
            </div>
          )}
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Required for verification: display name, contact email, country, city, address, website, and entity-specific identity fields.
          Optional: social profile, phone, description.
        </p>
      </NeoCard>

      {error ? <div className="error-card">{error}</div> : null}
      {success ? <div className="status-card">{success}</div> : null}

      {!isEditing ? (
        <NeoCard className="min-w-0 p-6">
          <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">Display Name</p>
              <p className="mt-1 break-words text-white">{form.name || 'N/A'}</p>
            </div>
            {form.entityType === 'organization' ? (
              <>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">Legal Name</p>
                  <p className="mt-1 break-words text-white">{form.legalName || 'N/A'}</p>
                </div>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">Registration Number</p>
                  <p className="mt-1 break-all text-white">{form.registrationNumber || 'N/A'}</p>
                </div>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">Industry</p>
                  <p className="mt-1 break-words text-white">{form.industry || 'N/A'}</p>
                </div>
              </>
            ) : (
              <>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">First Name</p>
                  <p className="mt-1 break-words text-white">{form.firstName || 'N/A'}</p>
                </div>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">Last Name</p>
                  <p className="mt-1 break-words text-white">{form.lastName || 'N/A'}</p>
                </div>
                <div className="metric-card min-w-0 !rounded-[18px] !p-3">
                  <p className="text-xs text-gray-500">Occupation</p>
                  <p className="mt-1 break-words text-white">{form.occupation || 'N/A'}</p>
                </div>
              </>
            )}
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">Email</p>
              <p className="mt-1 break-all text-white">{form.contactEmail || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">Phone</p>
              <p className="mt-1 break-words text-white">{form.phone || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">Country</p>
              <p className="mt-1 break-words text-white">{form.country || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">City</p>
              <p className="mt-1 break-words text-white">{form.city || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3 sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <p className="text-xs text-gray-500">Address</p>
              <p className="mt-1 break-words text-white">{form.addressLine || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">Website</p>
              <p className="mt-1 break-all text-white">{form.website || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3">
              <p className="text-xs text-gray-500">{socialPlatformLabel(form.socialPlatform)}</p>
              <p className="mt-1 break-all text-white">{form.socialHandle || 'N/A'}</p>
            </div>
            <div className="metric-card min-w-0 !rounded-[18px] !p-3 sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <p className="text-xs text-gray-500">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-white">{form.description || 'N/A'}</p>
            </div>
          </div>
        </NeoCard>
      ) : (
        <NeoCard className="min-w-0 p-6">
          <form onSubmit={handleSave} className="min-w-0 space-y-3">
            <NeoInput label="Display Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />

            {form.entityType === 'organization' ? (
              <>
                <NeoInput label="Legal Name" value={form.legalName} onChange={(e) => setField('legalName', e.target.value)} required />
                <NeoInput label="Industry" value={form.industry} onChange={(e) => setField('industry', e.target.value)} />
                <NeoInput label="Registration Number" value={form.registrationNumber} disabled className="opacity-70" />
              </>
            ) : (
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <NeoInput label="First Name" value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} required />
                <NeoInput label="Last Name" value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} required />
                <NeoInput label="Occupation" value={form.occupation} onChange={(e) => setField('occupation', e.target.value)} />
              </div>
            )}

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <NeoInput label="Contact Email" type="email" value={form.contactEmail} onChange={(e) => setField('contactEmail', e.target.value)} />
              <NeoInput label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
              <NeoInput label="Country" value={form.country} onChange={(e) => setField('country', e.target.value)} />
              <NeoInput label="City" value={form.city} onChange={(e) => setField('city', e.target.value)} />
              <NeoInput
                label="Address"
                value={form.addressLine}
                onChange={(e) => setField('addressLine', e.target.value)}
                containerClassName="sm:col-span-2 lg:col-span-3 xl:col-span-4"
              />
              <NeoInput label="Website" value={form.website} onChange={(e) => setField('website', e.target.value)} />
              <div className="mb-4">
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-[#8ca198]">Social Platform</label>
                <select
                  value={form.socialPlatform}
                  onChange={(e) => setField('socialPlatform', e.target.value)}
                  className="w-full rounded-[16px] border border-white/12 bg-black/28 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none"
                >
                  {SOCIAL_PLATFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#0b1411]">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <NeoInput
                label={socialPlatformLabel(form.socialPlatform)}
                value={form.socialHandle}
                placeholder={socialHandlePlaceholder(form.socialPlatform)}
                onChange={(e) => setField('socialHandle', e.target.value)}
              />
            </div>

            <div>
              <label className="ml-2 mb-2 block text-sm font-medium text-gray-300">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={4}
                className="w-full rounded-[16px] border border-white/12 bg-black/28 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] placeholder-[#61756d] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none"
                placeholder="Write a short company or individual summary"
              />
            </div>

            <div className="flex justify-end gap-2">
              <NeoButton
                type="button"
                variant="secondary"
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center justify-center px-3"
                aria-label="Cancel edit"
                title="Cancel edit"
              >
                <X className="h-4 w-4" />
              </NeoButton>
              <NeoButton
                type="submit"
                loading={saving}
                className="inline-flex items-center justify-center px-3"
                aria-label="Save profile"
                title="Save profile"
              >
                <Save className="h-4 w-4" />
              </NeoButton>
            </div>
          </form>
        </NeoCard>
      )}
    </div>
  );
};
