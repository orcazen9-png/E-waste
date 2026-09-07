import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Lot, RecyclerMatch } from '@ewaste/shared';

import { AppProvider, useApp } from './src/state/AppContext.tsx';
import { getMeta, listTransactions, setMeta } from './src/db/index.ts';
import { summariseTransactions } from './src/lib/ledger.ts';
import { colors } from './src/ui/theme.ts';
import { Onboarding } from './src/screens/Onboarding.tsx';
import { Home, type HomeDestination } from './src/screens/Home.tsx';
import { PriceBoard } from './src/screens/PriceBoard.tsx';
import { NewLot } from './src/screens/NewLot.tsx';
import { Buyers } from './src/screens/Buyers.tsx';
import { HandoverSlip } from './src/screens/HandoverSlip.tsx';
import { Ledger } from './src/screens/Ledger.tsx';
import { Safety } from './src/screens/Safety.tsx';

/**
 * Navigation is a state machine in one file rather than a routing library.
 *
 * The app has one linear flow (photo -> buyer -> slip) and four leaves off a
 * home screen; a router would add a dependency, an install size and a set of
 * lifecycle rules for no benefit here. Back is always explicit, which also
 * means there is no history stack to get lost in - a real problem for users who
 * cannot read the breadcrumb.
 */
type Route =
  | { name: 'home' }
  | { name: 'prices' }
  | { name: 'newLot' }
  | { name: 'buyers'; lot: Lot }
  | { name: 'handover'; lot: Lot; match: RecyclerMatch }
  | { name: 'ledger' }
  | { name: 'safety' };

function Router() {
  const { ready, language, setLanguage } = useApp();
  const [onboarded, setOnboarded] = useState<boolean | undefined>();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [totals, setTotals] = useState({ pending: 0, week: 0 });

  useEffect(() => {
    if (!ready) return;
    void getMeta('onboarded').then((value) => setOnboarded(value === '1'));
  }, [ready]);

  // Home shows money; recompute whenever we land back on it.
  useEffect(() => {
    if (route.name !== 'home') return;
    // Same summariser the ledger screen uses, so the two screens cannot
    // disagree about what the collector is owed.
    void listTransactions().then((rows) => {
      const totals = summariseTransactions(rows);
      setTotals({ pending: totals.pendingInr, week: totals.weekInr });
    });
  }, [route.name]);

  const goHome = useMemo(() => () => setRoute({ name: 'home' }), []);

  if (!ready || onboarded === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!onboarded) {
    return (
      <Onboarding
        onPick={async (picked) => {
          await setLanguage(picked);
          await setMeta('onboarded', '1');
          setOnboarded(true);
        }}
      />
    );
  }

  switch (route.name) {
    case 'prices':
      return <PriceBoard onBack={goHome} />;
    case 'ledger':
      return <Ledger onBack={goHome} />;
    case 'safety':
      return <Safety onBack={goHome} />;
    case 'newLot':
      return <NewLot onCancel={goHome} onDone={(lot) => setRoute({ name: 'buyers', lot })} />;
    case 'buyers':
      return (
        <Buyers
          lot={route.lot}
          onBack={goHome}
          onChoose={(match) => setRoute({ name: 'handover', lot: route.lot, match })}
        />
      );
    case 'handover':
      return <HandoverSlip lot={route.lot} match={route.match} onBack={goHome} onDone={goHome} />;
    default:
      return (
        <Home
          key={language}
          pendingDuesInr={totals.pending}
          earnedThisWeekInr={totals.week}
          // Written out rather than cast: an added tile then fails to compile
          // until it is routed somewhere, instead of silently doing nothing.
          onNavigate={(destination: HomeDestination) => {
            switch (destination) {
              case 'newLot':
                return setRoute({ name: 'newLot' });
              case 'prices':
                return setRoute({ name: 'prices' });
              case 'ledger':
                return setRoute({ name: 'ledger' });
              case 'safety':
                return setRoute({ name: 'safety' });
            }
          }}
        />
      );
  }
}

export function App() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Router />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
