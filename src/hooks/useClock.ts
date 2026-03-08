import { useState, useEffect } from "react";

function format12h(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const LUNCH_MESSAGES = [
  "吃饭啦! Go makan! 🍱",
  "Jom makan jom! 🐧",
  "Stop coding, 去吃饭! 🍜",
  "Hungry liao, go tapao! 🍕",
  "Nasi lemak time! 🍔",
  "肚子饿了, go eat la! 🍣",
  "Mamak time! 🥗",
  "Go 打包 lunch! 🍛",
  "12:30 了, makan! 🍝",
  "饭不能等! 🍚",
];

function pickLunchMsg(): string {
  const day = new Date().getDate();
  return LUNCH_MESSAGES[day % LUNCH_MESSAGES.length];
}

export function useClock(): { time: string; isLunch: boolean; lunchMsg: string } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const h = now.getHours();
  const m = now.getMinutes();
  const isLunch = h === 12 && m >= 30 && m < 45;

  return {
    time: format12h(now),
    isLunch,
    lunchMsg: isLunch ? pickLunchMsg() : "",
  };
}
