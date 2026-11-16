/*
 * Separa calentamiento y medición de un escalón de concurrencia y calcula, por fase y por
 * operación: peticiones, errores, media, p95 y throughput; además, usuarios activos.
 *
 * Uso (lo invoca scripts/run.sh; usa el Groovy incluido en JMeter, sin Node ni Python):
 *   java -cp "$JMETER_HOME/lib/*" groovy.ui.GroovyMain analyze-step.groovy \
 *        <results.jtl> <usuarios> <rampup_s> <warmup_s> <hold_s> <salida.json>
 *
 * Definiciones:
 *   t0                 inicio de la primera muestra del escalón (arranque del primer usuario).
 *   calentamiento      [t0, t0 + rampup + warmup)
 *   medición           [t0 + rampup + warmup, t0 + rampup + warmup + hold)
 *   una muestra pertenece a la fase en la que EMPIEZA.
 *   p95                percentil 95 por rango más cercano sobre el tiempo de respuesta (elapsed).
 *   throughput         peticiones de la fase / duración de la fase (s).
 *   usuarios activos   allThreads que JMeter registra en cada muestra (usuarios virtuales vivos,
 *                      incluidos los que están en pausa) -> mínimo, máximo y media.
 *   usuarios distintos hilos que registraron al menos una muestra en la fase.
 *   peticiones en vuelo máximo de peticiones simultáneas (solapamiento de [inicio, inicio+elapsed]).
 */
import groovy.json.JsonOutput

def (jtl, users, rampup, warmup, hold, out) = args.toList()
long ramp = rampup as long, warm = warmup as long, hld = hold as long

List<String> parseCsv(String line) {
    def fields = []; def sb = new StringBuilder(); boolean q = false
    for (int i = 0; i < line.length(); i++) {
        char c = line.charAt(i)
        if (q) {
            if (c == '"' as char) {
                if (i + 1 < line.length() && line.charAt(i + 1) == '"' as char) { sb.append('"'); i++ } else q = false
            } else sb.append(c)
        } else if (c == '"' as char) q = true
        else if (c == ',' as char) { fields << sb.toString(); sb.setLength(0) }
        else sb.append(c)
    }
    fields << sb.toString()
    fields
}

def lines = new File(jtl).readLines("UTF-8")
def header = parseCsv(lines[0])
def col = { String n -> def i = header.indexOf(n); if (i < 0) throw new IllegalStateException("Falta la columna ${n} en ${jtl}"); i }
int cTs = col('timeStamp'), cEl = col('elapsed'), cLb = col('label'), cOk = col('success'), cAll = col('allThreads'), cTh = col('threadName')
def samples = lines.drop(1).findAll { it.trim() }.collect { l ->
    def f = parseCsv(l)
    [ts: f[cTs] as long, el: f[cEl] as long, label: f[cLb], ok: f[cOk] == 'true', all: f[cAll] as int, thread: f[cTh]]
}
if (samples.isEmpty()) throw new IllegalStateException("Sin muestras en ${jtl}")

long t0 = samples*.ts.min()
def phases = [
    calentamiento: [t0, t0 + (ramp + warm) * 1000L],
    medicion     : [t0 + (ramp + warm) * 1000L, t0 + (ramp + warm + hld) * 1000L],
]

def p95 = { List<Long> v -> if (!v) return null; def s = v.sort(false); s[Math.max(0, (int) Math.ceil(0.95d * s.size()) - 1)] }
def stats = { List sm, double seconds ->
    [peticiones: sm.size(), errores: sm.count { !it.ok }, media_ms: sm ? Math.round(sm*.el.sum() / sm.size()) : null,
     p95_ms: p95(sm*.el), throughput_por_s: seconds > 0 ? Math.round(sm.size() / seconds * 100) / 100d : null]
}
def maxInFlight = { List sm ->
    def ev = []
    sm.each { ev << [it.ts, 1]; ev << [it.ts + it.el, -1] }
    ev.sort { a, b -> a[0] <=> b[0] ?: a[1] <=> b[1] }  // a igual instante, primero las salidas
    int cur = 0, mx = 0
    ev.each { cur += it[1]; mx = Math.max(mx, cur) }
    mx
}

def result = [usuarios_configurados: users as int, rampup_s: ramp, warmup_s: warm, hold_s: hld,
              inicio_epoch_ms: t0, fases: [:]]
phases.each { name, w ->
    def sm = samples.findAll { it.ts >= w[0] && it.ts < w[1] }
    double secs = (w[1] - w[0]) / 1000d
    def byLabel = sm.groupBy { it.label }.sort { it.key }.collectEntries { k, v -> [k, stats(v, secs)] }
    result.fases[name] = [
        ventana_epoch_ms : w,
        duracion_s       : secs,
        total            : stats(sm, secs),
        por_operacion    : byLabel,
        usuarios_activos : sm ? [min: sm*.all.min(), max: sm*.all.max(), media: Math.round(sm*.all.sum() / sm.size() * 10) / 10d] : null,
        usuarios_distintos_con_muestras: sm*.thread.unique().size(),
        max_peticiones_en_vuelo: maxInFlight(sm),
    ]
}
def after = samples.count { it.ts >= phases.medicion[1] }
result.muestras_fuera_de_ventana = after

new File(out).text = JsonOutput.prettyPrint(JsonOutput.toJson(result))

def m = result.fases.medicion
println "Escalón ${users} usuario(s): medición ${hld}s tras ${ramp + warm}s de calentamiento"
println "  usuarios activos (medición): min=${m.usuarios_activos?.min} max=${m.usuarios_activos?.max} media=${m.usuarios_activos?.media}; con muestras=${m.usuarios_distintos_con_muestras}; peticiones en vuelo máx=${m.max_peticiones_en_vuelo}"
println "  total: n=${m.total.peticiones} errores=${m.total.errores} media_ms=${m.total.media_ms} p95_ms=${m.total.p95_ms} tps=${m.total.throughput_por_s}"
m.por_operacion.each { k, v -> println "  ${k}: n=${v.peticiones} errores=${v.errores} media_ms=${v.media_ms} p95_ms=${v.p95_ms} tps=${v.throughput_por_s}" }
def c = result.fases.calentamiento
println "  (calentamiento, excluido: n=${c.total.peticiones} errores=${c.total.errores} usuarios activos max=${c.usuarios_activos?.max})"
