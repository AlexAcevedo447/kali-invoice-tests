# Imagen de tareas JMeter de kali-invoice-tests (independiente de Cypress: sin Node).
# Contiene Java 21, Apache JMeter 5.6.3 y jq; no contiene credenciales ni resultados.
# Uso (desde kali-invoice-tests/jmeter):
#   docker compose build
#   docker compose run --rm jmeter validate
#   docker compose run --rm jmeter smoke            # ambiente por defecto: local-docker
FROM eclipse-temurin:21.0.12_8-jre-noble

ARG JMETER_VERSION=5.6.3
# SHA-512 oficial publicado en https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.6.3.tgz.sha512
ARG JMETER_SHA512=5978a1a35edb5a7d428e270564ff49d2b1b257a65e17a759d259a9283fc17093e522fe46f474a043864aea6910683486340706d745fcdf3db1505fd71e689083

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/jmeter.tgz "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz" \
 && echo "${JMETER_SHA512}  /tmp/jmeter.tgz" | sha512sum -c - \
 && tar -xzf /tmp/jmeter.tgz -C /opt \
 && mv "/opt/apache-jmeter-${JMETER_VERSION}" /opt/jmeter \
 && rm -rf /tmp/jmeter.tgz /opt/jmeter/docs /opt/jmeter/printable_docs

ENV JMETER_HOME=/opt/jmeter \
    PATH="/opt/jmeter/bin:${PATH}" \
    KALI_PERF_ENV=local-docker \
    KALI_PERF_RESULTS_DIR=/perf/results

RUN useradd --create-home --uid 10001 perf && mkdir -p /perf/results && chown -R perf:perf /perf
WORKDIR /perf
COPY --chown=perf:perf config ./config
COPY --chown=perf:perf plans ./plans
COPY --chown=perf:perf scripts ./scripts
USER perf

VOLUME ["/perf/results"]
ENTRYPOINT ["/perf/scripts/run.sh"]
CMD ["validate"]
