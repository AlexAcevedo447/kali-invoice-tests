# Imagen de tareas Cypress de kali-invoice-tests (independiente de JMeter: sin Java).
# Contiene Node, Cypress 15.21.0 y navegadores; no contiene credenciales ni resultados.
# Uso (desde kali-invoice-tests/cypress):
#   docker compose build
#   docker compose run --rm cypress                         # suite completa
#   docker compose run --rm cypress --spec "e2e/api/**/*.cy.ts"
FROM cypress/included:15.21.0

WORKDIR /tests
# El binario de Cypress ya viene en la imagen base: npm ci no lo vuelve a descargar.
ENV CYPRESS_INSTALL_BINARY=0 \
    CI=1 \
    KALI_TEST_ENV=local-docker

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json cypress.config.ts ./
COPY config ./config
COPY e2e ./e2e
COPY support ./support
COPY fixtures ./fixtures

# Resultados (capturas, videos, JSON) en un volumen montado en tiempo de ejecución.
VOLUME ["/tests/results"]
ENTRYPOINT ["npx", "cypress", "run", "--browser", "electron"]
