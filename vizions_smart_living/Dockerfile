# Complemento local de Home Assistant: agente de Vizions Smart Living.
# Node 22 trae WebSocket integrado; el agente no usa paquetes de npm.
FROM node:22-alpine
WORKDIR /app
COPY app/ ./
RUN chmod +x /app/run.sh
CMD ["/bin/sh", "/app/run.sh"]
