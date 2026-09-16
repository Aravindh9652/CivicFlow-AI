import { useEffect, useRef } from "react";

/** Extra drifting stars to match the deployed GrievanceNet atmosphere. */
export default function Starfield() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const colors = ["#667eea", "#f093fb", "#43e97b", "#ff006e", "#ffbe0b", "#c4b5fd"];
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.25,
      c: colors[Math.floor(Math.random() * colors.length)],
      s: 0.00008 + Math.random() * 0.00035,
      a: 0.25 + Math.random() * 0.55,
    }));

    let raf;
    const draw = () => {
      const w = (canvas.width = window.innerWidth);
      const h = (canvas.height = window.innerHeight);
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        st.y -= st.s;
        if (st.y < 0) st.y = 1;
        ctx.globalAlpha = st.a;
        ctx.fillStyle = st.c;
        ctx.beginPath();
        ctx.arc(st.x * w, st.y * h, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
