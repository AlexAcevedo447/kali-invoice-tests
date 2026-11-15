/*
 * Aprovisiona (idempotente) los datos EXCLUSIVOS de performance de InvoiceKali:
 *   empresa perf.tenant.code, rol "perf-facturacion" con permisos de facturación,
 *   usuario perf.user.email, cliente perf.customer.document y producto perf.product.code.
 * Lo existente se reutiliza; nada se borra ni se modifica (si el usuario ya existe con
 * otra contraseña, el paso de verificación falla y se informa).
 *
 * Contraseñas SOLO desde variables de entorno (nunca se registran):
 *   KALI_PLATFORM_ADMIN_PASSWORD  administrador de plataforma (platform.admin.email)
 *   KALI_PERF_USER_PASSWORD       usuario de performance (12+ caracteres, mayúscula,
 *                                  minúscula, número y símbolo, sin espacios)
 * Lo ejecuta plans/provision-perf-data.jmx (JSR223, Groovy incluido en JMeter).
 */
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

def p = { String key ->
    def v = props.get(key)
    if (v == null || v.toString().trim().isEmpty()) throw new IllegalStateException("Falta la propiedad ${key}")
    v.toString().trim()
}
def secret = { String name ->
    def v = System.getenv(name)
    if (v == null || v.isEmpty()) throw new IllegalStateException("Falta la variable de entorno ${name}")
    v
}

def AUTH = "${p('auth.protocol')}://${p('auth.host')}:${p('auth.port')}/api/v1"
def INVOICE = "${p('invoice.protocol')}://${p('invoice.host')}:${p('invoice.port')}/api/v1"
def http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
def json = new JsonSlurper()
def enc = { String s -> URLEncoder.encode(s, StandardCharsets.UTF_8) }
def summary = []

def call = { String method, String url, String token, Object body ->
    def b = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20))
        .header("Content-Type", "application/json")
        .header("Idempotency-Key", UUID.randomUUID().toString())
    if (token) b.header("Authorization", "Bearer " + token)
    b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(JsonOutput.toJson(body)))
    def r = http.send(b.build(), HttpResponse.BodyHandlers.ofString())
    // Algunas rutas de auth responden 201 con texto plano ("Created"): solo se parsea JSON.
    def text = r.body()?.trim()
    def parsed = (text && (text.startsWith("{") || text.startsWith("["))) ? json.parseText(text) : text
    [status: r.statusCode(), body: parsed]
}
def expect = { Map r, List<Integer> ok, String what ->
    if (!ok.contains(r.status)) throw new IllegalStateException("${what}: HTTP ${r.status} ${r.body instanceof Map ? (r.body.error ?: '') : ''}")
    r
}
def login = { String email, String password, String what ->
    def r = expect(call("POST", "${AUTH}/auth/login", null, [email: email, password: password]), [200], what)
    r.body.access_token as String
}

// 1) Administrador de plataforma
def ptoken = login(p('platform.admin.email'), secret('KALI_PLATFORM_ADMIN_PASSWORD'), "Login del administrador de plataforma")

// 2) Empresa de performance
def tenants = expect(call("GET", "${AUTH}/tenants/", ptoken, null), [200], "Listar empresas").body
def tenant = tenants.find { it.Code == p('perf.tenant.code') }
if (tenant == null) {
    def created = expect(call("POST", "${AUTH}/tenants/", ptoken, [name: p('perf.tenant.name'), code: p('perf.tenant.code')]), [201], "Crear empresa de performance").body
    tenant = (created instanceof Map) ? created :
        expect(call("GET", "${AUTH}/tenants/", ptoken, null), [200], "Listar empresas").body.find { it.Code == p('perf.tenant.code') }
    if (tenant == null) throw new IllegalStateException("Empresa de performance no encontrada tras crearla")
    summary << "empresa creada"
} else summary << "empresa reutilizada"
def tenantId = tenant.Id as String

// 3) Permisos y rol de facturación
def grants = [["invoices", "read"], ["invoices", "manage"], ["customers", "read"], ["customers", "manage"], ["products", "read"], ["products", "manage"]]
def permissionIds = grants.collect { g ->
    def r = expect(call("POST", "${AUTH}/permissions/", ptoken, [tenant_id: tenantId, resource: g[0], action: g[1]]), [201, 409], "Permiso ${g[0]}/${g[1]}")
    if (r.status == 201 && r.body instanceof Map) return r.body.Id
    def all = expect(call("GET", "${AUTH}/permissions?tenant_id=${enc(tenantId)}", ptoken, null), [200], "Listar permisos").body
    def found = all.find { it.Resource?.toLowerCase() == g[0] && it.Action?.toLowerCase() == g[1] }
    if (found == null) throw new IllegalStateException("Permiso ${g[0]}/${g[1]} no encontrado tras 409")
    found.Id
}
def roleName = "perf-facturacion"
def roleRes = expect(call("POST", "${AUTH}/roles/", ptoken, [tenant_id: tenantId, name: roleName, description: "Usuario de pruebas de rendimiento"]), [201, 409], "Rol de performance")
def roleId = (roleRes.status == 201 && roleRes.body instanceof Map) ? roleRes.body.Id :
    expect(call("GET", "${AUTH}/roles?tenant_id=${enc(tenantId)}", ptoken, null), [200], "Listar roles").body.find { it.Name?.trim()?.toLowerCase() == roleName }?.Id
if (!roleId) throw new IllegalStateException("Rol ${roleName} no encontrado")
permissionIds.each { pid ->
    expect(call("POST", "${AUTH}/rbac/roles/permissions/assign", ptoken, [tenant_id: tenantId, role_id: roleId, permission_id: pid]), [200, 201, 204, 409], "Asignar permiso al rol")
}

// 4) Usuario de performance
def email = p('perf.user.email')
def userRes = expect(call("POST", "${AUTH}/users/", ptoken, [tenant_id: tenantId, identification_number: "9000000001", username: "perf.load", email: email, password: secret('KALI_PERF_USER_PASSWORD')]), [201, 409], "Usuario de performance")
summary << (userRes.status == 201 ? "usuario creado" : "usuario reutilizado")
def user = expect(call("GET", "${AUTH}/users/by-email?email=${enc(email)}&tenant_id=${enc(tenantId)}", ptoken, null), [200], "Consultar usuario de performance").body
expect(call("POST", "${AUTH}/rbac/users/roles/assign", ptoken, [tenant_id: tenantId, user_id: user.Id, role_id: roleId]), [200, 201, 204, 409], "Asignar rol al usuario")

// 5) Verificación: el usuario de performance inicia sesión con la contraseña indicada
def utoken = login(email, secret('KALI_PERF_USER_PASSWORD'), "Login del usuario de performance (si es 401, ya existía con otra contraseña)")

// 6) Cliente y producto de performance (en la empresa de performance)
def doc = p('perf.customer.document')
def customers = expect(call("GET", "${INVOICE}/customers?search=${enc(doc)}&page=1&page_size=10", utoken, null), [200], "Buscar cliente").body
if (!customers.find { it.Document == doc }) {
    expect(call("POST", "${INVOICE}/customers", utoken, [name: p('perf.customer.name'), document: doc]), [201], "Crear cliente de performance")
    summary << "cliente creado"
} else summary << "cliente reutilizado"
def code = p('perf.product.code')
def products = expect(call("GET", "${INVOICE}/products?search=${enc(code)}&page=1&page_size=10", utoken, null), [200], "Buscar producto").body
if (!products.find { it.Code == code }) {
    expect(call("POST", "${INVOICE}/products", utoken, [code: code, name: p('perf.product.name'), unit_price: 100]), [201], "Crear producto de performance")
    summary << "producto creado"
} else summary << "producto reutilizado"

def message = "Datos de performance listos en la empresa '${p('perf.tenant.code')}': ${summary.join(', ')}"
log.info(message)
SampleResult.setResponseMessage(message)
SampleResult.setResponseData(message, "UTF-8")
SampleResult.setSuccessful(true)
