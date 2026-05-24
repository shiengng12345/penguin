import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";

const GREETINGS = [
  (n: string) => `${n}, jom test API!`,
  (n: string) => `200 all along, ${n}`,
  (n: string) => `${n} entered the chat`,
  (n: string) => `ship it and pray, ${n}`,
  (n: string) => `sudo make ${n} kopi`,
  (n: string) => `${n}, walao bug again la`,
  (n: string) => `penguin believes in ${n}`,
  (n: string) => `kopi -> API calls, ${n}`,
  (n: string) => `${n}, no errors... hopefully`,
  (n: string) => `let ${n} cook`,
  (n: string) => `404: ${n}'s bugs not found`,
  (n: string) => `${n}, steady la`,
  (n: string) => `curl -X HUG ${n}`,
  (n: string) => `ping ${n}... pong!`,
  (n: string) => `${n}, 加油!`,
  (n: string) => `${n}.startSession()`,
  (n: string) => `oi ${n}, penguin say hi`,
  (n: string) => `${n}, don't play play`,
  (n: string) => `aiyo ${n}, sus API leh`,
  (n: string) => `${n}, need kopi first`,
  (n: string) => `${n}, shiok! all pass!`,
  (n: string) => `${n}, 做到半死 still going`,
  (n: string) => `${n}, faster debug la`,
  (n: string) => `${n}, damn power la`,
  (n: string) => `${n}, 没有bug today`,
  (n: string) => `${n}, 写code要开心`,
  (n: string) => `${n}, heng no 500`,
  (n: string) => `${n}, 冲啊!`,
  (n: string) => `cheer(${n})`,
  (n: string) => `${n}, go tapao first`,
  (n: string) => `${n}, on fire today`,
  (n: string) => `siao liao — jk, ${n}`,
];

// Returns a special greeting that overrides time-of-day + hourly rotation,
// or null for normal days. Precedence: fixed calendar dates > late-night > weekly.
function specialDayGreeting(name: string): string | null {
  const now = new Date();
  const date = now.getDate();
  const month = now.getMonth() + 1;
  const dayOfWeek = now.getDay();
  const hour = now.getHours();

  if (month === 8 && date === 31) return `${name}, Selamat Hari Merdeka! 🇲🇾`;
  if (date === 5) return `${name}, 出粮咯! kopi on you la 💰`;

  // Late-night OT (1-4am) — wins over weekly Friday but not calendar events above
  if (hour >= 1 && hour < 5) return `${name}, 兄弟你确定还在 debug? 🌙`;

  // dayOfWeek: 0 = Sunday, 5 = Friday
  if (dayOfWeek === 5) return `${name}, friday vibes, 周末啦 🍻`;

  return null;
}

function timeOfDayGreeting(name: string): string {
  const special = specialDayGreeting(name);
  if (special) return special;
  const hour = new Date().getHours();
  if (hour < 8) return `${name}, so early ah?`;
  if (hour < 12) return `早安 ${name}!`;
  if (hour < 14) return `午安 ${name}!`;
  if (hour < 17) return `${name}, 下午好!`;
  if (hour < 19) return `${name}, almost done la`;
  if (hour < 21) return `晚上好 ${name}!`;
  return `${name}, OT king sia`;
}

function pickGreeting(name: string): string {
  const special = specialDayGreeting(name);
  if (special) return special;
  const now = Date.now();
  const hourSlot = Math.floor(now / 3_600_000);
  const idx = hourSlot % GREETINGS.length;
  return GREETINGS[idx](name);
}

export function useGreeting(): string {
  const userName = useAppStore((s) => s.userName);
  const [isFirstHour, setIsFirstHour] = useState(true);
  const [greeting, setGreeting] = useState(() =>
    userName ? timeOfDayGreeting(userName) : "Penguin"
  );

  useEffect(() => {
    if (!userName) {
      setGreeting("Penguin");
      return;
    }

    setGreeting(timeOfDayGreeting(userName));
    setIsFirstHour(true);

    const firstTimeout = setTimeout(() => {
      setIsFirstHour(false);
      setGreeting(pickGreeting(userName));
    }, 5_000);

    return () => clearTimeout(firstTimeout);
  }, [userName]);

  useEffect(() => {
    if (!userName || isFirstHour) return;

    setGreeting(pickGreeting(userName));

    const msUntilNextHour =
      3_600_000 - (Date.now() % 3_600_000);

    const timeout = setTimeout(() => {
      setGreeting(pickGreeting(userName));
    }, msUntilNextHour);

    const interval = setInterval(() => {
      setGreeting(pickGreeting(userName));
    }, 3_600_000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [userName, isFirstHour]);

  return greeting;
}
