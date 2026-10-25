import { useEffect, useState } from "react";
import { api, ApiError, ResumenDia, hora, duracion, fechaLarga, hoyLocal, restarDias, ETIQUETA_TIPO } from "../api";

export default function Historial() {
  const [hasta, setHasta] = useState(hoyLocal());
  const [desde, setDesde] = useState(restarDias(hoyLocal(), 30));
  const [dias, setDias] = useState<ResumenDia[] | null>(null);
  const [error, setError] = useState("");

  async function cargar() {
    setError("");
    setDias(null);
    try {
      const r = await api.historial(desde, hasta);
      setDias(r.dias);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
      setDias([]);
    }
  }

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = (dias ?? []).reduce((s, d) => s + d.minutosTrabajados, 0);

  return (
    <section>
      <div className="tarjeta">
        <h2>Mi historial</h2>
        <form className="filtros" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
          <label>Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} required /></label>
          <label>Hasta<input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} required /></label>
          <button className="btn btn-secundario">Consultar</button>
        </form>
        {error && <p className="error">{error}</p>}
        {dias && <p className="nota">Total trabajado en el periodo: <strong>{duracion(total)}</strong> · {dias.length} día(s) con fichajes</p>}
      </div>

      {dias === null ? (
        <div className="centrado-bloque"><div className="spinner" /></div>
      ) : dias.length === 0 ? (
        <p className="nota centrado-bloque">No hay fichajes en este periodo.</p>
      ) : (
        <div className="tabla-contenedor tarjeta">
          <table className="tabla">
            <thead>
              <tr><th>Día</th><th>Fichajes</th><th>Pausa</th><th>Trabajado</th></tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr key={d.fecha}>
                  <td className="capitalizar">{fechaLarga(d.fecha)}</td>
                  <td>
                    <div className="chips">
                      {d.fichajes.map((f, i) => (
                        <span key={i} className={`chip chip-${f.tipo.toLowerCase()}`} title={ETIQUETA_TIPO[f.tipo]}>
                          {ETIQUETA_TIPO[f.tipo]} {hora(f.fechaHoraUtc)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{duracion(d.minutosPausa)}</td>
                  <td><strong>{duracion(d.minutosTrabajados)}</strong>{d.abierto && <span className="nota"> (en curso)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
