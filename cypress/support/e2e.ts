import "./commands";

/**
 * Diagnóstico de fallos: añade al mensaje de error el estado de la página bajo prueba
 * (URL, readyState, recursos cargados y los más lentos). Sirve para distinguir una
 * página que no terminó de cargar (p. ej. un módulo que no llegó del servidor) de un
 * fallo funcional. No cambia el resultado: el error se vuelve a lanzar siempre.
 */
Cypress.on("fail", (err) => {
  try {
    const win = (cy as unknown as { state: (k: string) => Window | undefined }).state("window");
    if (win?.performance) {
      const origin = win.location.origin;
      const resources = win.performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const short = (r: PerformanceResourceTiming) => `${Math.round(r.duration)}ms ${r.name.replace(origin, "")}`;
      const slowest = [...resources].sort((a, b) => b.duration - a.duration).slice(0, 5).map(short);
      const last = resources.slice(-3).map(short);
      err.message +=
        `\n\n[diagnóstico de página] url=${win.location.href} readyState=${win.document.readyState}` +
        ` recursos_cargados=${resources.length} raíz_react_con_contenido=${Boolean(win.document.getElementById("root")?.childElementCount)}` +
        `\n  más lentos: ${slowest.join(" | ") || "-"}\n  últimos cargados: ${last.join(" | ") || "-"}`;
    }
  } catch {
    // El diagnóstico nunca debe ocultar ni reemplazar el error original.
  }
  throw err;
});
