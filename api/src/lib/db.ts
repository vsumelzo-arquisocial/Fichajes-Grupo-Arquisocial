import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

// Errores transitorios típicos de Azure SQL (incluye BD serverless reanudándose tras auto-pausa)
const TRANSIENT = new Set([4060, 40197, 40501, 40613, 49918, 49919, 49920, 4221, 10928, 10929]);

function crearPool(): Promise<sql.ConnectionPool> {
  const cs = process.env.SQL_CONNECTION_STRING;
  if (!cs) throw new Error("Falta SQL_CONNECTION_STRING");
  const pool = new sql.ConnectionPool(cs);
  pool.on("error", () => {
    poolPromise = null;
  });
  return pool.connect();
}

export async function getPool(): Promise<sql.ConnectionPool> {
  for (let intento = 1; intento <= 4; intento++) {
    try {
      if (!poolPromise) poolPromise = crearPool();
      return await poolPromise;
    } catch (err: any) {
      poolPromise = null;
      const code = err?.originalError?.info?.number ?? err?.number;
      const esTransitorio = TRANSIENT.has(code) || err?.code === "ETIMEOUT" || err?.code === "ESOCKET";
      if (!esTransitorio || intento === 4) throw err;
      await new Promise((r) => setTimeout(r, 5000 * intento));
    }
  }
  throw new Error("No se pudo conectar a la base de datos");
}

export { sql };
