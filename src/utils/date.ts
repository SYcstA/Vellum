import { useState, useEffect } from "react";

/** Local YYYY-MM-DD (matches SQLite date('now','localtime')). */
export function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Today's local date string, re-rendering the consumer when the date rolls over
 * (e.g. the app is left open past midnight) so date-derived UI stays accurate.
 */
export function useLocalToday(): string {
  const [today, setToday] = useState(localDateStr);
  useEffect(() => {
    const id = setInterval(() => {
      setToday((prev) => {
        const now = localDateStr();
        return prev === now ? prev : now;
      });
    }, 30000);
    return () => clearInterval(id);
  }, []);
  return today;
}
