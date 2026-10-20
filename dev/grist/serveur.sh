#!/bin/sh
# Lance un vrai Grist (image officielle) pour tester le widget, sans toucher au vrai document.
# On se connecte avec l’en-tête X-Forwarded-User sur /auth/login (voir lib.js) : on peut donc être plusieurs personnes à la fois.
#   sh dev/grist/serveur.sh          démarre (ou redémarre à vide) Grist sur http://127.0.0.1:8484
#   sh dev/grist/serveur.sh stop     l'arrête
set -e
NOM=grist-test
docker rm -f "$NOM" >/dev/null 2>&1 || true
[ "$1" = "stop" ] && exit 0
docker run -d --name "$NOM" --network host \
  -e PORT=8484 -e APP_HOME_URL=http://127.0.0.1:8484 \
  -e GRIST_SANDBOX_FLAVOR=unsandboxed \
  -e GRIST_IN_SERVICE=true -e GRIST_ADMIN_EMAIL=antoine.philippon@u-bordeaux.fr \
  -e GRIST_FORWARD_AUTH_HEADER=X-Forwarded-User \
  -e GRIST_SINGLE_ORG=docs -e GRIST_ORG_IN_PATH=false \
  gristlabs/grist:latest >/dev/null
echo "Attente de Grist..."
for i in $(seq 1 60); do
  [ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H 'X-Forwarded-User: test@exemple.org' http://127.0.0.1:8484/auth/login)" = 302 ] && { echo "Grist prêt : http://127.0.0.1:8484"; exit 0; }
  sleep 1
done
echo "Grist ne répond pas" >&2
exit 1
