import {
  gameStartCountdownRemaining,
  type GameStartCountdown,
} from "@bpc/shared-types";
import { useEffect, useState } from "react";

/** Live seconds remaining for producer game-start countdown (1s tick). */
export function useGameStartCountdown(
  cd: GameStartCountdown | null | undefined,
): number {
  const [remaining, setRemaining] = useState(() =>
    gameStartCountdownRemaining(cd),
  );

  useEffect(() => {
    const tick = () => setRemaining(gameStartCountdownRemaining(cd));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cd?.running, cd?.endsAt, cd?.secondsRemaining, cd?.label]);

  return remaining;
}
