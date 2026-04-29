let initialized = false;

function asTrimmed(value: unknown) {
  return String(value || '').trim();
}

export async function initJoyId() {
  const mod = await import('@joyid/ckb');
  if (!initialized) {
    if (typeof mod.initConfig === 'function') {
      mod.initConfig({
        name: 'Realta',
        logo: `${window.location.origin}/favicon.ico`,
      });
    }
    initialized = true;
  }
  return mod as any;
}

export async function connectJoyId() {
  const mod = await initJoyId();
  if (typeof mod.connect !== 'function') {
    throw new Error('JoyID connect() is unavailable.');
  }
  const res = await mod.connect();
  const address = asTrimmed(res?.address || res?.ckbAddress || res?.data?.address);
  const publicKey = asTrimmed(res?.pubkey || res?.publicKey || res?.public_key || res?.data?.pubkey);
  if (!address) throw new Error('JoyID did not return a wallet address.');
  return { address, publicKey, raw: res };
}

export async function signJoyIdChallenge(challengeHexOrText: string) {
  const mod = await initJoyId();
  if (typeof mod.signChallenge !== 'function') {
    throw new Error('JoyID signChallenge() is unavailable.');
  }
  const res = await mod.signChallenge(challengeHexOrText);
  const signature = asTrimmed(res?.signature || res?.sig || res?.data?.signature || res);
  const publicKey = asTrimmed(res?.pubkey || res?.publicKey || res?.public_key || res?.data?.pubkey);
  if (!signature) throw new Error('JoyID did not return a signature.');
  return { signature, publicKey, raw: res };
}

function normalizeTxForJoyId(tx: any) {
  return {
    version: tx?.version || '0x0',
    cellDeps: tx?.cellDeps || tx?.cell_deps || [],
    headerDeps: tx?.headerDeps || tx?.header_deps || [],
    inputs: tx?.inputs || [],
    outputs: tx?.outputs || [],
    outputsData: tx?.outputsData || tx?.outputs_data || [],
    witnesses: tx?.witnesses || [],
  };
}

function extractSignedOutput(result: any, fallbackTx: any) {
  const signedTx = result?.tx || result?.signedTx || result?.signed_tx || result?.data?.tx || result?.data?.signedTx || null;
  if (signedTx && typeof signedTx === 'object') {
    return { signedTx };
  }
  const signedWitnesses = result?.witnesses || result?.signedWitnesses || result?.data?.witnesses || null;
  if (Array.isArray(signedWitnesses) && signedWitnesses.length > 0) {
    return { signedWitnesses };
  }
  const signature = asTrimmed(result?.signature || result?.sig || result?.data?.signature);
  if (signature) {
    return { signatures: [{ index: 0, signature }] };
  }
  if (Array.isArray(result) && result.length > 0) {
    return { signedWitnesses: result };
  }
  return { signedTx: fallbackTx };
}

export async function signJoyIdTransaction(txLike: any) {
  const mod = await initJoyId();
  const tx = normalizeTxForJoyId(txLike);
  const attempts: Array<() => Promise<any>> = [];

  if (typeof mod.signRawTransaction === 'function') {
    attempts.push(() => mod.signRawTransaction(tx));
    attempts.push(() => mod.signRawTransaction({ tx }));
    attempts.push(() => mod.signRawTransaction({ rawTx: tx }));
  }
  if (typeof mod.signTransaction === 'function') {
    attempts.push(() => mod.signTransaction(tx));
    attempts.push(() => mod.signTransaction({ tx }));
  }

  let lastError: any = null;
  for (const run of attempts) {
    try {
      const result = await run();
      return extractSignedOutput(result, tx);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`JoyID transaction signing failed: ${lastError?.message || 'unknown error'}`);
}

