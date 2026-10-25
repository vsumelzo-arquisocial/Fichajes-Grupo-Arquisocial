import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirPorDia, estadoTras, accionesPermitidas } from "../src/lib/jornada";

const d = (s: string) => new Date(s);

test("estado y acciones", () => {
  assert.equal(estadoTras(null), "FUERA");
  assert.deepEqual(accionesPermitidas(estadoTras("ENTRADA")), ["PAUSA_INICIO", "SALIDA"]);
  assert.deepEqual(accionesPermitidas(estadoTras("PAUSA_INICIO")), ["PAUSA_FIN"]);
  assert.deepEqual(accionesPermitidas(estadoTras("SALIDA")), ["ENTRADA"]);
});

test("jornada con pausa", () => {
  const r = resumirPorDia([
    { tipo: "ENTRADA", fechaHoraUtc: d("2026-10-20T06:00:00Z") },
    { tipo: "PAUSA_INICIO", fechaHoraUtc: d("2026-10-20T09:00:00Z") },
    { tipo: "PAUSA_FIN", fechaHoraUtc: d("2026-10-20T09:30:00Z") },
    { tipo: "SALIDA", fechaHoraUtc: d("2026-10-20T14:00:00Z") },
  ], "Europe/Madrid");
  assert.equal(r.length, 1);
  assert.equal(r[0].fecha, "2026-10-20");
  assert.equal(r[0].minutosTrabajados, 180 + 270);
  assert.equal(r[0].minutosPausa, 30);
  assert.equal(r[0].abierto, false);
});

test("turno nocturno se atribuye al día de inicio (hora local)", () => {
  const r = resumirPorDia([
    { tipo: "ENTRADA", fechaHoraUtc: d("2026-10-20T21:00:00Z") }, // 23:00 Madrid (CEST)
    { tipo: "SALIDA", fechaHoraUtc: d("2026-10-21T05:00:00Z") },
  ], "Europe/Madrid");
  const dia20 = r.find(x => x.fecha === "2026-10-20")!;
  assert.equal(dia20.minutosTrabajados, 480);
});

test("jornada abierta cuenta hasta ahora", () => {
  const r = resumirPorDia([{ tipo: "ENTRADA", fechaHoraUtc: d("2026-10-20T07:00:00Z") }], "Europe/Madrid", d("2026-10-20T08:15:00Z"));
  assert.equal(r[0].minutosTrabajados, 75);
  assert.equal(r[0].abierto, true);
});
