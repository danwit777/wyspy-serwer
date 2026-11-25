# Wyspy Owoców Mocy 3D — serwer multiplayer

Serwer Aarona.

Gra + mały serwer, który łączy graczy. Każdy otwiera zwykły link w przeglądarce — bez kont i logowania.

- do **4 graczy w jednym świecie** (piąty automatycznie trafia do „Świata 2”, itd.)
- **kooperacja**: wspólni wrogowie i bossowie, widać ataki innych
- **PvP**: klawisz **P** włącza/wyłącza. Walczą tylko gracze, którzy **obaj** mają PvP włączone. W **Mieście Portowym** jest strefa bezpieczna.
- zapis postępu zostaje w przeglądarce każdego gracza (jak dotąd)

## Pliki

| Plik | Co to jest |
|---|---|
| `server.js` | serwer (Node.js + WebSocket) — serwuje grę i przekazuje stan graczy |
| `public/index.html` | gra (ta sama co na Claude) |
| `public/mp-shim.js` | łącznik gry z serwerem |
| `package.json` | zależności (`ws`) |

## 1. Test w domu (ta sama sieć Wi-Fi) — 5 minut

Potrzebny Node.js 18+ (https://nodejs.org).

```bash
cd wyspy-serwer
npm install
npm start
```

- Na tym komputerze: `http://localhost:8080`
- Na innych urządzeniach w tym samym Wi-Fi: `http://<IP-komputera>:8080` (IP: `ipconfig` na Windows, `ip a` na Linux).
- Windows przy pierwszym starcie zapyta o zaporę — trzeba zezwolić na sieć prywatną.

## 2. W internecie — Render (darmowo)

1. Wrzuć ten folder do repozytorium na GitHubie (np. `wyspy-serwer`).
2. Na https://render.com: **New → Web Service** → wybierz repozytorium.
3. Ustawienia:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. Po wdrożeniu dostajesz adres typu `https://wyspy-xxxx.onrender.com` — to jest link dla kolegów.

Uwaga: darmowy serwer na Render usypia po 15 minutach bez ruchu. Pierwsze wejście po przerwie trwa ok. minuty. Plan płatny (Starter) nie usypia.

## 3. W internecie — własny VPS (stabilnie)

Na serwerze z Linuxem (Ubuntu):

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
# gra
cd /opt && sudo git clone <twoje-repo> wyspy && cd wyspy && sudo npm install
sudo npm install -g pm2 && pm2 start server.js --name wyspy && pm2 save && pm2 startup
```

HTTPS najprościej przez Caddy (`/etc/caddy/Caddyfile`):

```
gra.twojadomena.pl {
    reverse_proxy localhost:8080
}
```

Caddy sam załatwia certyfikat. WebSocket (`/ws`) przechodzi bez dodatkowej konfiguracji.

## Aktualizacja gry

Podmień `public/index.html` na nową wersję gry. Serwer sam ją przeładuje (bez restartu).
Gra pobrana z Claude działa tu bez zmian — łącznik `mp-shim.js` jest doklejany automatycznie.

## Limity serwera (w `server.js`)

- `ROOM_CAP = 8` — twardy limit osób w pokoju (gra i tak wpuszcza 4 do świata)
- `MAX_CONN = 200` — połączeń łącznie
- `MAX_RATE = 40` — wiadomości na sekundę od jednego gracza
- `/health` — adres do sprawdzania, czy serwer żyje

## Znane ograniczenia

- Każdy gracz liczy swój świat u siebie, a serwer tylko przekazuje stan i trafienia. Dla grupy kolegów to wystarcza, ale da się oszukiwać (np. edytując zapis w przeglądarce).
- Wrogowie mogą lekko się różnić pozycją między graczami; trafienia i zabicia są wspólne.
