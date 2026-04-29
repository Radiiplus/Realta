const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function setCookie(name: string, value: string) {
  const encodedName = encodeURIComponent(name);
  const encodedValue = encodeURIComponent(String(value || ''));
  document.cookie = `${encodedName}=${encodedValue}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function getCookie(name: string) {
  const encodedName = encodeURIComponent(name);
  const pairs = String(document.cookie || '').split(';');
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.trim().split('=');
    if (rawKey === encodedName) {
      return decodeURIComponent(rest.join('=') || '');
    }
  }
  return '';
}

function clearCookie(name: string) {
  const encodedName = encodeURIComponent(name);
  document.cookie = `${encodedName}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getWalletAddress() {
  return getCookie('walletAddress');
}

export function getWalletProvider() {
  return getCookie('walletProvider');
}

export function getWalletPublicKey() {
  return getCookie('walletPublicKey');
}

export function getWalletLabel() {
  return getCookie('walletLabel');
}

export function getOrgId() {
  return getCookie('orgId');
}

export function getOrgKey() {
  return getCookie('orgKey');
}

export function getOrgName() {
  return getCookie('orgName');
}

export function hasWalletSession() {
  return Boolean(getWalletAddress());
}

export function hasOrgSession() {
  return Boolean(hasWalletSession() && getOrgId() && getOrgKey());
}

export function setWalletSession(
  walletAddress: string,
  walletLabel?: string,
  options?: { provider?: string; publicKey?: string },
) {
  setCookie('walletAddress', walletAddress.trim());
  setCookie('walletProvider', String(options?.provider || 'joyid'));
  if (options?.publicKey) {
    setCookie('walletPublicKey', String(options.publicKey).trim());
  } else {
    clearCookie('walletPublicKey');
  }
  if (walletLabel && walletLabel.trim()) {
    setCookie('walletLabel', walletLabel.trim());
  } else {
    clearCookie('walletLabel');
  }
  return walletAddress.trim();
}

export function clearWalletSession() {
  clearCookie('walletAddress');
  clearCookie('walletProvider');
  clearCookie('walletPublicKey');
  clearCookie('walletLabel');
  clearCookie('orgId');
  clearCookie('orgName');
  clearCookie('orgKey');
}

export function setOrgSession(orgId: string, orgKey: string, orgName?: string) {
  setCookie('orgId', orgId);
  setCookie('orgKey', orgKey);
  if (orgName && orgName.trim()) {
    setCookie('orgName', orgName.trim());
  } else {
    clearCookie('orgName');
  }
}

export function clearOrgSession() {
  clearCookie('orgId');
  clearCookie('orgName');
  clearCookie('orgKey');
}
