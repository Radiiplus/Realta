import { CheckCircle2, CircleDashed, FileSignature, Link2, Paperclip, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NeoCard } from '../components/neocard';
import { NeoInput } from '../components/input';
import { NeoButton } from '../components/button';
import { api } from '../api';
import { signJoyIdTransaction } from '../lib/joyid';
import { getOrgId } from '../session';

const toHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;

const sha256Hex = async (text: string) => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
};

const sha256FileHex = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(new Uint8Array(digest));
};

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const commaIndex = result.indexOf(',');
    if (commaIndex >= 0) {
      resolve(result.slice(commaIndex + 1));
      return;
    }
    resolve(result);
  };
  reader.onerror = () => reject(new Error('Failed to read selected document.'));
  reader.readAsDataURL(file);
});

const CREDENTIAL_TEMPLATES = [
  { value: 'authenticity', label: 'Authenticity Certificate' },
  { value: 'completion', label: 'Course Completion' },
  { value: 'membership', label: 'Membership Confirmation' },
  { value: 'employment', label: 'Employment Verification' },
  { value: 'custom', label: 'Custom Title' },
];

const formatCkbFromHex = (hexValue: string) => {
  const raw = String(hexValue || '0x0');
  const asBigInt = BigInt(raw);
  return (Number(asBigInt) / 100000000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForTxCommitted = async (txHash: string, maxAttempts = 20, intervalMs = 1500) => {
  for (let i = 0; i < maxAttempts; i += 1) {
    const statusRes = await api.tx.getStatus(txHash);
    const state = String(statusRes?.data?.state || '').toLowerCase();
    if (state === 'committed') return;
    if (state === 'rejected') {
      throw new Error('Submitted transaction was rejected on-chain.');
    }
    await sleep(intervalMs);
  }
  throw new Error('Transaction is not committed yet. Please wait a few seconds and try linking again.');
};

const parseHexPairFromError = (message: string) => {
  const required = /required=(0x[0-9a-f]+)/i.exec(message)?.[1] || null;
  const available = /available=(0x[0-9a-f]+)/i.exec(message)?.[1] || null;
  return { required, available };
};

type UploadedContent = {
  id: string;
  contentHash: string;
  pointer: string;
  pointerType: string;
  fileFingerprint: string;
};

type LinkSuccess = {
  credentialId: string;
  shareUrl: string;
};

type IssuanceSessionRecord = {
  id: string;
  token: string;
  orgId: string;
  orgName?: string;
  credentialType: string;
  credentialTitle?: string | null;
  note?: string | null;
  status: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  userSubmission?: {
    walletAddress?: string;
    keyId?: string;
    profile?: {
      fullName?: string;
      email?: string | null;
      reference?: string | null;
    };
  } | null;
};

export const IssueCredential = () => {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [txHash, setTxHash] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploadedContent, setUploadedContent] = useState<UploadedContent | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<LinkSuccess | null>(null);
  const [sessionNote, setSessionNote] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [sessions, setSessions] = useState<IssuanceSessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionWorking, setSessionWorking] = useState(false);

  const [simpleForm, setSimpleForm] = useState({
    credentialType: 'authenticity',
    customTitle: '',
    recipientName: '',
    recipientReference: '',
    description: '',
  });

  const [techForm, setTechForm] = useState({
    contentHash: '',
    ckbfsPointer: '',
    recipientLockArg: '',
    flag: 'ISSUED',
  });

  const resolveCredentialTitle = () => {
    const selectedTemplate = CREDENTIAL_TEMPLATES.find((t) => t.value === simpleForm.credentialType)?.label || '';
    return simpleForm.credentialType === 'custom' ? simpleForm.customTitle.trim() : selectedTemplate;
  };

  const finalCredentialTitle = useMemo(() => resolveCredentialTitle(), [simpleForm.credentialType, simpleForm.customTitle]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  const loadSessions = async () => {
    setSessionLoading(true);
    try {
      const res = await api.issuanceSession.list();
      setSessions((res.data?.sessions || []) as IssuanceSessionRecord[]);
    } catch (err) {
      console.error(err);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const buildTechnicalFields = async (contentHash: string, pointerSeed: string, recipientReference: string) => {
    const pointerHash = await sha256Hex(`${pointerSeed}|pointer|${contentHash}`);
    const recipientHash = await sha256Hex(`${recipientReference}|recipient`);

    return {
      contentHash,
      ckbfsPointer: pointerHash,
      recipientLockArg: `0x${recipientHash.slice(2, 42)}`,
      flag: 'ISSUED',
    };
  };

  const getFileFingerprint = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  const ensureUploadedContent = async (file: File, title: string) => {
    const fingerprint = getFileFingerprint(file);
    if (uploadedContent && uploadedContent.fileFingerprint === fingerprint) {
      return uploadedContent;
    }
    const localHash = await sha256FileHex(file);
    const base64Payload = await fileToBase64(file);
    const uploadRes = await api.content.upload({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileDataBase64: base64Payload,
      contentHash: localHash,
      title,
    });
    const content = uploadRes.data?.content;
    if (!content?.id || !content?.contentHash || !content?.pointer) {
      throw new Error('Document upload succeeded but content response is incomplete.');
    }
    const nextContent: UploadedContent = {
      id: String(content.id),
      contentHash: String(content.contentHash),
      pointer: String(content.pointer),
      pointerType: String(content.pointerType || 'web2'),
      fileFingerprint: fingerprint,
    };
    setUploadedContent(nextContent);
    return nextContent;
  };

  const handleCreateSession = async () => {
    setSessionWorking(true);
    setError('');
    try {
      const res = await api.issuanceSession.create({
        credentialType: simpleForm.credentialType,
        credentialTitle: finalCredentialTitle || undefined,
        note: sessionNote || undefined,
        ttlMinutes: 20,
      });
      setSessionUrl(String(res.data?.sessionUrl || ''));
      setSessionNote('');
      await loadSessions();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to create issuance session.');
    } finally {
      setSessionWorking(false);
    }
  };

  const handleUseSession = (session: IssuanceSessionRecord) => {
    const fullName = session.userSubmission?.profile?.fullName || '';
    const reference = session.userSubmission?.profile?.reference || session.userSubmission?.walletAddress || '';
    const email = session.userSubmission?.profile?.email || '';
    setSelectedSessionId(session.id);
    setSimpleForm((prev) => ({
      ...prev,
      credentialType: session.credentialType || prev.credentialType,
      recipientName: fullName || prev.recipientName,
      recipientReference: reference || prev.recipientReference,
      description: email ? `Session claimant email: ${email}` : prev.description,
    }));
  };

  const handleBuildAndSign = async () => {
    setError('');
    const finalTitle = resolveCredentialTitle();
    let fundingLockArgForError = '';
    const claimantName = selectedSession?.userSubmission?.profile?.fullName || '';
    const claimantReference = selectedSession?.userSubmission?.profile?.reference || selectedSession?.userSubmission?.walletAddress || '';

    if (!selectedSession) {
      setError('Select a submitted user session first. Issuance must come from user-signed session identity.');
      return;
    }
    if (selectedSession.status !== 'submitted') {
      setError('Selected session is not ready for issuing.');
      return;
    }
    if (!finalTitle || !claimantName.trim() || !claimantReference.trim()) {
      setError('Selected session is missing claimant identity fields.');
      return;
    }
    if (!documentFile) {
      setError('Please attach the supporting document before issuing this credential.');
      return;
    }

    setLoading(true);
    try {
      if (claimantReference !== simpleForm.recipientReference) {
        setSimpleForm((prev) => ({ ...prev, recipientReference: claimantReference }));
      }
      const content = await ensureUploadedContent(documentFile, finalTitle);
      const generated = await buildTechnicalFields(content.contentHash, content.pointer, claimantReference);
      const payload = {
        contentHash: generated.contentHash,
        ckbfsPointer: generated.ckbfsPointer,
        recipientLockArg: generated.recipientLockArg,
        flag: 'ISSUED',
      };

      setTechForm(payload);
      const orgId = String(getOrgId() || '').trim();
      if (!orgId) throw new Error('Missing active organization session.');
      const orgRes = await api.org.get(orgId);
      const walletLockArg = String(orgRes?.data?.organization?.issuerLockArg || '').trim();
      if (!walletLockArg) {
        throw new Error('Organization issuerLockArg is missing. Set it in organization profile before issuing.');
      }
      fundingLockArgForError = walletLockArg;

      const payloadRes = await api.ndcp.issuePayload(payload);
      const templateRes = await api.tx.build({
        ...payloadRes.data,
        ...payload,
        network: 'devnet',
        fromLockArg: walletLockArg,
        lockArgs: walletLockArg,
      });
      const templateTx = templateRes.data?.txSkeleton || templateRes.data?.template;

      const hasLiveLikeInputs = Array.isArray(templateTx?.inputs)
        && templateTx.inputs.length > 0
        && templateTx.inputs.every((input: any) => {
          const prev = input?.previousOutput || input?.previous_output;
          const txHash = prev?.txHash || prev?.tx_hash;
          const index = prev?.index;
          return Boolean(txHash) && index !== undefined && index !== null;
        });

      if (!templateTx?.inputs || !templateTx?.outputs || !templateTx?.witnesses) {
        throw new Error('Template transaction is incomplete for direct submit.');
      }
      if (!hasLiveLikeInputs) {
        throw new Error('Template has placeholder/non-live inputs.');
      }
      const signed = await signJoyIdTransaction(templateTx);
      let submitRes;
      if (signed.signedTx) {
        submitRes = await api.tx.submit({
          network: 'devnet',
          tx: signed.signedTx,
        });
      } else if (Array.isArray(signed.signedWitnesses) && signed.signedWitnesses.length > 0) {
        submitRes = await api.tx.submitFlow({
          network: 'devnet',
          txSkeleton: templateTx,
          signedWitnesses: signed.signedWitnesses,
        });
      } else if (Array.isArray(signed.signatures) && signed.signatures.length > 0) {
        submitRes = await api.tx.submitFlow({
          network: 'devnet',
          txSkeleton: templateTx,
          signatures: signed.signatures,
        });
      } else {
        throw new Error('JoyID signing did not return a usable signed transaction payload.');
      }
      setTxHash(submitRes.data.txHash || submitRes.data.hash || '');

      setStep(2);
    } catch (err: any) {
      console.error(err);
      const backendError = err?.response?.data?.error;
      const backendCode = err?.response?.data?.code;
      if (backendCode === 'INSUFFICIENT_LIVE_CAPACITY') {
        const details = parseHexPairFromError(String(backendError || ''));
        const required = details.required || '0x0';
        const available = details.available || '0x0';
        const shortfall = BigInt(required) > BigInt(available)
          ? `0x${(BigInt(required) - BigInt(available)).toString(16)}`
          : '0x0';
        setError(
          `Insufficient devnet funding capacity for lock ${fundingLockArgForError || '(unknown)'}. `
          + `Required ${formatCkbFromHex(required)} CKB, available ${formatCkbFromHex(available)} CKB `
          + `(shortfall ${formatCkbFromHex(shortfall)} CKB). Fund this lock and retry.`,
        );
        return;
      }
      if (backendCode === 'INPUTS_NOT_LIVE') {
        const detail = Array.isArray(err?.response?.data?.details) ? err.response.data.details[0] : null;
        const outPoint = detail?.outPoint;
        const outPointText = outPoint?.txHash && outPoint?.index
          ? ` (${outPoint.txHash}:${outPoint.index})`
          : '';
        setError(
          `Transaction inputs became stale${outPointText}. Click "Build and Sign Transaction" again to rebuild with current live cells and resubmit.`,
        );
        return;
      }
      if (backendError) {
        setError(`${backendError}${backendCode ? ` (${backendCode})` : ''}`);
        return;
      }
      setError(err instanceof Error ? err.message : 'Transaction building or submission failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async () => {
    if (!uploadedContent?.id) {
      setError('Missing uploaded document metadata. Build and sign again to publish the document.');
      return;
    }
    if (!selectedSessionId) {
      setError('Missing issuance session. Select a user-submitted session first.');
      return;
    }
    setLoading(true);
    try {
      await waitForTxCommitted(txHash);
      const linkRes = await api.credential.linkOnchain({
        txHash,
        index: 0,
        ...techForm,
        contentId: uploadedContent.id,
        issuanceSessionId: selectedSessionId,
        title: resolveCredentialTitle(),
      });
      setLinkSuccess({
        credentialId: String(linkRes.data?.credential?.id || ''),
        shareUrl: String(linkRes.data?.shareUrl || ''),
      });
      setStep(3);
      await loadSessions();
    } catch (err: any) {
      const backendError = err?.response?.data?.error;
      setError(backendError || 'Failed to link credential');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell page-stack">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Issuance Wizard</div>
            <h2 className="page-title">Build, sign, and link credential records</h2>
            <p className="page-subtitle">
              Start from a user-submitted authorization session, attach the supporting document, then push the issuance through the on-chain NDCP flow.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <FileSignature className="h-4 w-4 text-neo-accent" />
              <span>Issuance sequence</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-[#8ca198]">
              <p className={step >= 1 ? 'text-neo-accent' : ''}>1. Prepare claimant and document inputs</p>
              <p className={step >= 2 ? 'text-neo-accent' : ''}>2. Sign and submit transaction</p>
              <p className={step >= 3 ? 'text-neo-accent' : ''}>3. Link record for portal sharing</p>
            </div>
          </div>
        </div>
      </NeoCard>

      {error ? <div className="error-card">{error}</div> : null}

      <NeoCard className="mx-auto w-full max-w-[860px] p-6">
        <h3 className="mb-3 text-lg font-semibold text-white">User Authorization Sessions</h3>
        <p className="mb-3 text-sm text-gray-400">
          Create a short-lived link, share it with the user, then issue using submitted identity.
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <NeoInput
            label="Session Note (Optional)"
            placeholder="Reason or context shared with the user"
            value={sessionNote}
            onChange={(e) => setSessionNote(e.target.value)}
            containerClassName="mb-0"
          />
          <NeoButton
            onClick={() => void handleCreateSession()}
            loading={sessionWorking}
            className="md:self-center mt-5"
          >
            Create Session Link
          </NeoButton>
        </div>
        {sessionUrl ? (
          <div className="status-card mt-3 text-xs text-emerald-200">
            <p className="mb-1">Share this URL with the user:</p>
            <p className="break-all">{sessionUrl}</p>
          </div>
        ) : null}
        <div className="mt-4 space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">Recent Sessions</p>
          {sessionLoading ? (
            <p className="text-sm text-gray-500">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-500">No sessions yet.</p>
          ) : (
            sessions.slice(0, 6).map((session) => {
              const status = String(session.status || '').toLowerCase();
              const timeExpired = Date.now() > Date.parse(String(session.expiresAt || ''));
              const expired = status === 'expired' || (status === 'pending' && timeExpired);
              const submitted = status === 'submitted' && session.userSubmission?.profile?.fullName;
              const selected = session.id === selectedSessionId;
              return (
                <div key={session.id} className={`rounded-[18px] border px-3 py-3 text-xs ${selected ? 'border-neo-accent/25 bg-neo-accent/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-gray-300">
                      {session.credentialType.toUpperCase()} {session.credentialTitle ? `- ${session.credentialTitle}` : ''}
                    </p>
                    <p className={expired ? 'text-yellow-300' : 'text-gray-500'}>
                      {expired ? 'expired' : session.status}
                    </p>
                  </div>
                  <p className="mt-1 text-gray-500">
                    {new Date(session.expiresAt).toLocaleString()}
                  </p>
                  {submitted ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-neo-accent">User: {session.userSubmission?.profile?.fullName}</p>
                      <NeoButton
                        variant="secondary"
                        onClick={() => handleUseSession(session)}
                        disabled={expired || status !== 'submitted'}
                        className="px-2 py-1 text-xs"
                      >
                        {selected ? 'Selected' : 'Use'}
                      </NeoButton>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </NeoCard>

      <div className="columns-1 gap-4 xl:columns-2">
        <div className="mb-4 break-inside-avoid">
          {step === 1 && (
            <NeoCard className="p-6">
              <h3 className="mb-4 text-xl text-neo-accent">Step 1: Credential Details</h3>

              <div className="mb-4">
                <label className="ml-2 mb-2 block text-sm font-medium text-gray-300">Credential Type</label>
                <select
                  value={simpleForm.credentialType}
                  onChange={(e) => setSimpleForm({ ...simpleForm, credentialType: e.target.value })}
                  className="w-full rounded-[16px] border border-white/12 bg-black/28 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none"
                >
                  {CREDENTIAL_TEMPLATES.map((template) => (
                    <option key={template.value} value={template.value} className="bg-black">
                      {template.label}
                    </option>
                  ))}
                </select>
              </div>
              {simpleForm.credentialType === 'custom' ? (
                <NeoInput
                  label="Custom Title"
                  placeholder="Enter custom credential title"
                  value={simpleForm.customTitle}
                  onChange={(e) => setSimpleForm({ ...simpleForm, customTitle: e.target.value })}
                />
              ) : null}
              <div className="info-card">
                <p className="text-xs uppercase tracking-wide text-gray-500">Claimant (From Signed Session)</p>
                {selectedSession?.userSubmission?.profile?.fullName ? (
                  <div className="mt-2 space-y-1 text-sm text-gray-300">
                    <p>Name: {selectedSession.userSubmission.profile.fullName}</p>
                    <p>
                      Reference: {selectedSession.userSubmission.profile.reference || selectedSession.userSubmission.walletAddress || 'N/A'}
                    </p>
                    {selectedSession.userSubmission.profile.email ? (
                      <p>Email: {selectedSession.userSubmission.profile.email}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">Select a submitted user session above to load claimant details.</p>
                )}
              </div>
              <NeoInput
                label="Description (Optional)"
                placeholder="Short context for this credential"
                value={simpleForm.description}
                onChange={(e) => setSimpleForm({ ...simpleForm, description: e.target.value })}
              />
              <div className="mb-4">
                <label className="ml-2 mb-2 block text-sm font-medium text-gray-300">Supporting Document</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null;
                    setDocumentFile(selected);
                    setUploadedContent(null);
                  }}
                  className="w-full rounded-neo border border-white/30 bg-black/80 px-4 py-3 text-sm text-neo-text transition-all file:mr-3 file:rounded-neo file:border file:border-white/20 file:bg-[#111] file:px-3 file:py-1.5 file:text-xs file:text-gray-200 hover:file:border-white/35 focus:border-neo-accent/85 focus:outline-none"
                />
                <p className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                  <Paperclip className="h-3.5 w-3.5" />
                  This file is uploaded and published automatically during issue.
                </p>
                {documentFile ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Selected: {documentFile.name} ({(documentFile.size / 1024).toFixed(1)} KB)
                  </p>
                ) : null}
              </div>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-neo border border-white/20 px-3 py-2 text-sm text-gray-300 hover:border-white/35"
                >
                  <Settings2 className="h-4 w-4" />
                  {showAdvanced ? 'Hide Advanced Fields' : 'Show Advanced Fields'}
                </button>
              </div>

              {showAdvanced ? (
                <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                  <p className="mb-2 text-xs text-gray-500">
                    Advanced values are auto-constructed from your submission and cannot be edited manually.
                  </p>
                  <div className="space-y-2 text-xs">
                    <div className="metric-card !rounded-[16px] !p-3">
                      <p className="text-gray-500">Content Hash</p>
                      <p className="break-all text-gray-300">{techForm.contentHash || 'Will be generated at submission'}</p>
                    </div>
                    <div className="metric-card !rounded-[16px] !p-3">
                      <p className="text-gray-500">CKBFS Pointer</p>
                      <p className="break-all text-gray-300">{techForm.ckbfsPointer || 'Will be generated at submission'}</p>
                    </div>
                    <div className="metric-card !rounded-[16px] !p-3">
                      <p className="text-gray-500">Recipient Lock Arg</p>
                      <p className="break-all text-gray-300">{techForm.recipientLockArg || 'Will be generated at submission'}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <NeoButton onClick={handleBuildAndSign} loading={loading} className="mt-4 w-full">
                Build and Sign Transaction
              </NeoButton>
            </NeoCard>
          )}

          {step === 2 && (
            <NeoCard className="p-6">
              <h3 className="mb-4 inline-flex items-center gap-2 text-xl text-neo-accent">
                <CircleDashed className="h-5 w-5" />
                Step 2: Confirm On-Chain
              </h3>
              <p className="mb-4 text-gray-400">
                Transaction Submitted: <code className="text-white">{txHash}</code>
              </p>
              {uploadedContent?.id ? (
                <p className="mb-2 text-xs text-gray-500">
                  Published content: <code className="text-gray-300">{uploadedContent.id}</code>
                </p>
              ) : null}
              <p className="mb-6 text-sm text-gray-500">Waiting for confirmation...</p>
              <NeoButton onClick={handleLink} loading={loading} className="w-full">
                <span className="inline-flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Link to Portal Record
                </span>
              </NeoButton>
            </NeoCard>
          )}

          {step === 3 && (
            <NeoCard className="border-neo-accent/20 p-6">
              <h3 className="mb-4 inline-flex items-center gap-2 text-xl text-neo-accent">
                <CheckCircle2 className="h-5 w-5" />
                Success
              </h3>
              <p>Credential has been issued and linked.</p>
              <NeoButton
                onClick={() => {
                  setStep(1);
                  setTxHash('');
                  setDocumentFile(null);
                  setUploadedContent(null);
                  setSelectedSessionId('');
                  setLinkSuccess(null);
                  setSimpleForm({
                    credentialType: 'authenticity',
                    customTitle: '',
                    recipientName: '',
                    recipientReference: '',
                    description: '',
                  });
                  setTechForm({ contentHash: '', ckbfsPointer: '', recipientLockArg: '', flag: 'ISSUED' });
                }}
                className="mt-4"
              >
                Issue Another
              </NeoButton>
            </NeoCard>
          )}
        </div>

        <div className="mb-4 break-inside-avoid">
          <NeoCard className="p-5">
            <h3 className="mb-3 text-lg font-semibold text-white">Flow Status</h3>
            <div className="space-y-2 text-sm">
              <p className={step >= 1 ? 'text-neo-accent' : 'text-gray-500'}>1. Credential details provided</p>
              <p className={step >= 2 ? 'text-neo-accent' : 'text-gray-500'}>2. Transaction built and submitted</p>
              <p className={step >= 3 ? 'text-neo-accent' : 'text-gray-500'}>3. On-chain link confirmed</p>
            </div>
          </NeoCard>
        </div>
      </div>
      {linkSuccess ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4">
          <div className="w-full max-w-lg rounded-neo border border-neo-accent/40 bg-[#050505] p-6 shadow-[0_0_0_1px_rgba(0,255,157,0.25),0_20px_50px_rgba(0,0,0,0.55)]">
            <h3 className="mb-3 inline-flex items-center gap-2 text-xl font-semibold text-neo-accent">
              <CheckCircle2 className="h-5 w-5" />
              Credential Linked
            </h3>
            <p className="text-sm text-gray-300">
              Credential has been linked successfully and is ready to share.
            </p>
            {linkSuccess.credentialId ? (
              <p className="mt-3 break-all text-xs text-gray-500">
                Credential ID: <span className="text-gray-300">{linkSuccess.credentialId}</span>
              </p>
            ) : null}
            {linkSuccess.shareUrl ? (
              <p className="mt-2 break-all text-xs text-gray-500">
                Share URL: <span className="text-gray-300">{linkSuccess.shareUrl}</span>
              </p>
            ) : null}
            <div className="mt-5 flex justify-end">
              <NeoButton
                variant="secondary"
                onClick={() => setLinkSuccess(null)}
              >
                Close
              </NeoButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
