# Prompt pour OpenClaw — Installation Weather-Poly sur Hetzner

Copie-colle ce prompt complet à OpenClaw :

---

Je vais te donner 3 fichiers à installer sur le serveur pour le projet weather-poly. Fais tout dans l'ordre.

## Étape 1 : Installer psycopg2

```bash
pip3 install psycopg2-binary
```

## Étape 2 : Créer le dossier

```bash
mkdir -p /opt/weather-poly
```

## Étape 3 : Créer le fichier schema SQL

Crée le fichier `/opt/weather-poly/01_schema.sql` avec le contenu du fichier `hetzner/01_schema.sql` (je te l'envoie séparément).

## Étape 4 : Appliquer le schema

```bash
psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -f /opt/weather-poly/01_schema.sql
```

Vérifie : `psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -c "\dt"`

## Étape 5 : Créer les fichiers Python

Crée `/opt/weather-poly/pipeline_pg.py` et `/opt/weather-poly/api.py` (je te les envoie).

## Étape 6 : Insérer les villes

```bash
psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -c "
INSERT INTO cities (station, name, slug, flag, unit, resolution_source, active, lat, lon, country) VALUES
('EGLC', 'London', 'london', '🇬🇧', 'C', 'wu', true, 51.5053, -0.0553, 'GB'),
('KLGA', 'New York', 'new-york', '🇺🇸', 'F', 'wu', true, 40.7769, -73.8740, 'US'),
('RKSI', 'Seoul', 'seoul', '🇰🇷', 'C', 'wu', true, 37.4602, 126.4407, 'KR'),
('RJTT', 'Tokyo', 'tokyo', '🇯🇵', 'C', 'wu', true, 35.5494, 139.7798, 'JP'),
('LFPG', 'Paris', 'paris', '🇫🇷', 'C', 'wu', true, 48.9984, 2.5879, 'FR'),
('EDDB', 'Berlin', 'berlin', '🇩🇪', 'C', 'openmeteo', true, 52.3667, 13.5033, 'DE'),
('OMDB', 'Dubai', 'dubai', '🇦🇪', 'C', 'openmeteo', true, 25.2528, 55.3644, 'AE'),
('YSSY', 'Sydney', 'sydney', '🇦🇺', 'C', 'openmeteo', true, -33.9461, 151.1772, 'AU'),
('VHHH', 'Hong Kong', 'hong-kong', '🇭🇰', 'C', 'openmeteo', true, 22.3089, 113.9146, 'HK'),
('LEMD', 'Madrid', 'madrid', '🇪🇸', 'C', 'openmeteo', true, 40.4936, -3.5668, 'ES'),
('SBGR', 'São Paulo', 'sao-paulo', '🇧🇷', 'C', 'openmeteo', true, -23.4356, -46.4731, 'BR'),
('VIDP', 'Delhi', 'delhi', '🇮🇳', 'C', 'openmeteo', true, 28.5562, 77.1000, 'IN'),
('ZBAA', 'Beijing', 'beijing', '🇨🇳', 'C', 'openmeteo', true, 40.0799, 116.6031, 'CN'),
('CYYZ', 'Toronto', 'toronto', '🇨🇦', 'C', 'openmeteo', true, 43.6772, -79.6306, 'CA'),
('EGLL', 'Heathrow', 'heathrow', '🇬🇧', 'C', 'wu', true, 51.4700, -0.4543, 'GB'),
('LIRF', 'Rome', 'rome', '🇮🇹', 'C', 'openmeteo', true, 41.8003, 12.2389, 'IT'),
('KJFK', 'JFK', 'jfk', '🇺🇸', 'F', 'wu', true, 40.6413, -73.7781, 'US'),
('WSSS', 'Singapore', 'singapore', '🇸🇬', 'C', 'openmeteo', true, 1.3644, 103.9915, 'SG'),
('FACT', 'Cape Town', 'cape-town', '🇿🇦', 'C', 'openmeteo', true, -33.9715, 18.6021, 'ZA'),
('NZAA', 'Auckland', 'auckland', '🇳🇿', 'C', 'openmeteo', true, -37.0082, 174.7850, 'NZ'),
('LTFM', 'Istanbul', 'istanbul', '🇹🇷', 'C', 'openmeteo', true, 41.2608, 28.7418, 'TR'),
('RPLL', 'Manila', 'manila', '🇵🇭', 'C', 'openmeteo', true, 14.5086, 121.0197, 'PH'),
('DNMM', 'Lagos', 'lagos', '🇳🇬', 'C', 'openmeteo', true, 6.5774, 3.3212, 'NG'),
('UUEE', 'Moscow', 'moscow', '🇷🇺', 'C', 'openmeteo', true, 55.9726, 37.4146, 'RU'),
('SCEL', 'Santiago', 'santiago', '🇨🇱', 'C', 'openmeteo', true, -33.3930, -70.7858, 'CL'),
('WMKK', 'Kuala Lumpur', 'kuala-lumpur', '🇲🇾', 'C', 'openmeteo', true, 2.7456, 101.7099, 'MY'),
('OEJN', 'Jeddah', 'jeddah', '🇸🇦', 'C', 'openmeteo', true, 21.6702, 39.1500, 'SA'),
('VTBS', 'Bangkok', 'bangkok', '🇹🇭', 'C', 'openmeteo', true, 13.6900, 100.7501, 'TH'),
('FAOR', 'Johannesburg', 'johannesburg', '🇿🇦', 'C', 'openmeteo', true, -26.1392, 28.2460, 'ZA'),
('MMMX', 'Mexico City', 'mexico-city', '🇲🇽', 'C', 'openmeteo', true, 19.4363, -99.0721, 'MX'),
('LOWW', 'Vienna', 'vienna', '🇦🇹', 'C', 'openmeteo', true, 48.1103, 16.5697, 'AT'),
('EHAM', 'Amsterdam', 'amsterdam', '🇳🇱', 'C', 'openmeteo', true, 52.3105, 4.7683, 'NL'),
('RKSS', 'Gimpo', 'gimpo', '🇰🇷', 'C', 'wu', true, 37.5586, 126.7906, 'KR'),
('VABB', 'Mumbai', 'mumbai', '🇮🇳', 'C', 'openmeteo', true, 19.0896, 72.8656, 'IN'),
('NZWN', 'Wellington', 'wellington', '🇳🇿', 'C', 'openmeteo', true, -41.3272, 174.8052, 'NZ')
ON CONFLICT (station) DO NOTHING;
"
```

## Étape 7 : Créer le service API (systemd)

```bash
cat > /etc/systemd/system/weatherpoly-api.service << 'EOF'
[Unit]
Description=Weather-Poly API
After=postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/weather-poly
ExecStart=/usr/bin/python3 /opt/weather-poly/api.py
Restart=always
RestartSec=5
Environment=DATABASE_URL=dbname=weatherpoly user=weatherpoly password=wp_b28a537c321173b4ed40342f host=127.0.0.1
Environment=API_PORT=8080

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable weatherpoly-api
systemctl start weatherpoly-api
systemctl status weatherpoly-api
```

## Étape 8 : Ouvrir le port 8080

```bash
ufw allow 8080/tcp
```

## Étape 9 : Setup le cron

```bash
# Ajoute ces lignes au crontab (crontab -e) :
cat >> /tmp/wp_cron << 'EOF'
# Weather-Poly Pipeline
*/10 * * * * cd /opt/weather-poly && /usr/bin/python3 pipeline_pg.py all >> /var/log/weatherpoly.log 2>&1
EOF

# Merge avec le crontab existant
crontab -l > /tmp/existing_cron 2>/dev/null
cat /tmp/wp_cron >> /tmp/existing_cron
crontab /tmp/existing_cron
rm /tmp/wp_cron /tmp/existing_cron

# Créer le fichier log
touch /var/log/weatherpoly.log
```

## Étape 10 : Tester

```bash
# Test API
curl http://127.0.0.1:8080/health

# Test DB
psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -c "SELECT count(*) FROM cities;"

# Test pipeline (juste events pour commencer)
cd /opt/weather-poly && python3 pipeline_pg.py events

# Vérifier qu'il a trouvé des events
psql -U weatherpoly -d weatherpoly -h 127.0.0.1 -c "SELECT count(*) FROM poly_events;"

# Test API externe
curl http://91.98.195.31:8080/cities?select=name,station,flag&active=eq.true&order=name
```

Donne-moi le résultat de chaque commande de l'étape 10.
