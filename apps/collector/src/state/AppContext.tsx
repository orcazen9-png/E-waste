import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Localization from 'expo-localization';
import {
  RuleBasedValuer,
  newId,
  type LanguageCode,
  type PriceIndex,
  type Recycler,
  type TranslationKey,
  t as translate,
  translateCoded,
} from '@ewaste/shared';
import {
  cachedPriceIndex,
  cachedRecyclers,
  getMeta,
  openDatabase,
  pendingCount,
  setMeta,
} from '../db/index.ts';
import { runSync, type SyncState } from '../sync/syncManager.ts';
import { api, setAccessToken } from '../api/client.ts';
import { DEMO_DISTRICT, seedDemoData } from '../demo/index.ts';

/**
 * Application state.
 *
 * Everything a screen needs to work with no connectivity lives here: the
 * language, the cached price index, the cached recycler list, and the
 * device identity that signs handover slips. Sync updates these in the
 * background; no screen ever awaits it.
 */

interface AppState {
  ready: boolean;
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => Promise<void>;
  collectorId: string;
  deviceId: string;
  deviceSecret: string;
  district: string;
  setDistrict: (district: string) => Promise<void>;
  priceIndex: PriceIndex | undefined;
  priceIndexFetchedAt: string | undefined;
  recyclers: Recycler[];
  sync: SyncState;
  syncNow: () => Promise<void>;
  /** True once a token exists. False means the app works offline-only. */
  signedIn: boolean;
  /** Running on data bundled into the app, with nothing uploaded. */
  demoMode: boolean;
  enterDemoMode: () => Promise<void>;
  requestSignInCode: (phone: string) => Promise<{ challengeId: string; devCode?: string }>;
  completeSignIn: (input: { challengeId: string; code: string; phone: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Translate a key in the current language. */
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  /** Expand a coded reason emitted by the domain services. */
  tc: (coded: string) => string;
  refreshLocalData: () => Promise<void>;
}

const AppContext = createContext<AppState | undefined>(undefined);

const META = {
  language: 'language',
  collectorId: 'collectorId',
  deviceId: 'deviceId',
  deviceSecret: 'deviceSecret',
  district: 'district',
  onboarded: 'onboarded',
  accessToken: 'accessToken',
  tokenExpiresAt: 'tokenExpiresAt',
  demoMode: 'demoMode',
} as const;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<LanguageCode>('mr');
  const [collectorId, setCollectorId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [deviceSecret, setDeviceSecret] = useState('');
  const [district, setDistrictState] = useState('Pune');
  const [priceIndex, setPriceIndex] = useState<PriceIndex>();
  const [priceIndexFetchedAt, setPriceIndexFetchedAt] = useState<string>();
  const [recyclers, setRecyclers] = useState<Recycler[]>([]);
  const [sync, setSync] = useState<SyncState>({ kind: 'idle', pending: 0 });
  const [signedIn, setSignedIn] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const refreshLocalData = useCallback(async () => {
    const [index, recyclerList, pending] = await Promise.all([
      cachedPriceIndex(),
      cachedRecyclers(),
      pendingCount(),
    ]);
    setPriceIndex(index?.index);
    setPriceIndexFetchedAt(index?.fetchedAt);
    setRecyclers(recyclerList);
    setSync((current) => (current.kind === 'syncing' ? current : { ...current, pending }));
  }, []);

  useEffect(() => {
    void (async () => {
      await openDatabase();

      // Identity is created on the device, not handed down by a server: the app
      // has to be usable the first time it is opened, with no signal.
      const storedCollector = (await getMeta(META.collectorId)) ?? newId('COL');
      const storedDevice = (await getMeta(META.deviceId)) ?? newId('DEV');
      // The secret that signs handover slips never leaves the phone.
      const storedSecret = (await getMeta(META.deviceSecret)) ?? `${newId('SEC')}${newId('SEC')}`;
      await setMeta(META.collectorId, storedCollector);
      await setMeta(META.deviceId, storedDevice);
      await setMeta(META.deviceSecret, storedSecret);

      // Restore the session. An expired token is treated as absent rather
      // than left to 401 every background sync.
      const storedToken = await getMeta(META.accessToken);
      const tokenExpiresAt = await getMeta(META.tokenExpiresAt);
      if (storedToken && (!tokenExpiresAt || Date.parse(tokenExpiresAt) > Date.now())) {
        setAccessToken(storedToken);
        setSignedIn(true);
      }

      if ((await getMeta(META.demoMode)) === '1') setDemoMode(true);

      const storedLanguage = (await getMeta(META.language)) as LanguageCode | undefined;
      const deviceLanguage = detectLanguage();
      const storedDistrict = (await getMeta(META.district)) ?? 'Pune';

      setCollectorId(storedCollector);
      setDeviceId(storedDevice);
      setDeviceSecret(storedSecret);
      setLanguageState(storedLanguage ?? deviceLanguage);
      setDistrictState(storedDistrict);

      await refreshLocalData();
      setReady(true);
    })();
  }, [refreshLocalData]);

  const syncNow = useCallback(async () => {
    // Demo mode never talks to a server, and with no token there is nothing to
    // sync to. Both are no-ops rather than errors: the app works either way.
    if (!collectorId || !signedIn || demoMode) return;
    await runSync({ collectorId, deviceId, deviceSecret, district, onState: setSync });
    await refreshLocalData();
  }, [collectorId, signedIn, demoMode, deviceId, deviceSecret, district, refreshLocalData]);

  const enterDemoMode = useCallback(async () => {
    await seedDemoData();
    await setMeta(META.demoMode, '1');
    await setMeta(META.district, DEMO_DISTRICT);
    setDistrictState(DEMO_DISTRICT);
    setDemoMode(true);
    await refreshLocalData();
  }, [refreshLocalData]);

  const requestSignInCode = useCallback(async (phone: string) => {
    const result = await api.requestCode(phone);
    return { challengeId: result.challengeId, devCode: result.devCode };
  }, []);

  const completeSignIn = useCallback(
    async (input: { challengeId: string; code: string; phone: string }) => {
      const result = await api.verifyCode({
        ...input,
        deviceId,
        preferredLanguage: language,
        district,
        state: 'Maharashtra',
        platform: 'android',
      });

      // The server is authoritative for the collector id, so adopt the one it
      // returns. A phone signing in again gets its existing history back.
      await setMeta(META.collectorId, result.collector.collectorId);
      await setMeta(META.accessToken, result.token);
      await setMeta(META.tokenExpiresAt, result.expiresAt);
      setCollectorId(result.collector.collectorId);
      setAccessToken(result.token);
      setSignedIn(true);
    },
    [deviceId, language, district],
  );

  const signOut = useCallback(async () => {
    await setMeta(META.accessToken, '');
    await setMeta(META.tokenExpiresAt, '');
    setAccessToken(undefined);
    setSignedIn(false);
  }, []);

  // A rejected token must flip the UI back to signed-out, or the app quietly
  // stops syncing and the collector never finds out.
  useEffect(() => {
    if (sync.kind === 'signed_out') setSignedIn(false);
  }, [sync.kind]);


  // Sync on start and then on a slow timer. Fifteen minutes is deliberate: more
  // often wastes battery and data on a phone that may be charged once a day.
  useEffect(() => {
    if (!ready) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 15 * 60_000);
    return () => clearInterval(timer);
  }, [ready, syncNow]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      language,
      setLanguage: async (next) => {
        setLanguageState(next);
        await setMeta(META.language, next);
      },
      collectorId,
      deviceId,
      deviceSecret,
      district,
      setDistrict: async (next) => {
        setDistrictState(next);
        await setMeta(META.district, next);
      },
      priceIndex,
      priceIndexFetchedAt,
      recyclers,
      sync,
      syncNow,
      signedIn,
      demoMode,
      enterDemoMode,
      requestSignInCode,
      completeSignIn,
      signOut,
      t: (key, values) => translate(language, key, values),
      tc: (coded) => translateCoded(language, coded),
      refreshLocalData,
    }),
    [
      ready,
      language,
      collectorId,
      deviceId,
      deviceSecret,
      district,
      priceIndex,
      priceIndexFetchedAt,
      recyclers,
      sync,
      syncNow,
      signedIn,
      demoMode,
      enterDemoMode,
      requestSignInCode,
      completeSignIn,
      signOut,
      refreshLocalData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

/** A valuer over the cached index, or undefined until the first sync lands. */
export function useValuer(): RuleBasedValuer | undefined {
  const { priceIndex } = useApp();
  return useMemo(() => (priceIndex ? new RuleBasedValuer(priceIndex) : undefined), [priceIndex]);
}

function detectLanguage(): LanguageCode {
  const tag = Localization.getLocales()[0]?.languageCode ?? 'mr';
  if (tag === 'hi') return 'hi';
  if (tag === 'en') return 'en';
  return 'mr';
}

export { META as META_KEYS };
