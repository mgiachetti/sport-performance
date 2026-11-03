import { router } from 'expo-router';
import { PlayerAccessScreen } from '../../src/screens/sign-in.tsx';
import { useServices } from '../../src/state/app-context.tsx';

/** Sign-in of a player without email, with the code a guardian generated (ADR 0042). */
export default function PlayerCode() {
  const { session } = useServices();
  return (
    <PlayerAccessScreen
      redeem={(code) => session.redeemPlayerAccess({ code })}
      onUseEmail={() => {
        router.back();
      }}
    />
  );
}
