@echo off
rem ======================================================================
rem  Pico bijwerken: GitHub, server (VPS) en webinterface in een keer.
rem  Dubbelklik dit bestand op je laptop. Het staat in:
rem    C:\Users\Administrator\OneDrive\Bureaublad\keukenbot\update-pico.bat
rem
rem  1. Je wijzigingen gaan naar GitHub (main).
rem  2. Vercel bouwt de webinterface daarna vanzelf opnieuw.
rem  3. De server (149.210.205.238) haalt de nieuwe code op, bouwt en
rem     herstart de bot. Je typt daar 1x je wachtwoord (sudo).
rem  Testnummers krijgen na de herstart vanzelf het updatebericht.
rem ======================================================================
setlocal
cd /d "%~dp0"
set SERVER=maartendejonge24@149.210.205.238

echo.
echo === Pico bijwerken ===
echo.

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set TAK=%%b
if /i not "%TAK%"=="main" (
  echo Je staat op tak "%TAK%", niet op main. Eerst: git checkout main
  goto :fout
)

rem Alleen code meenemen. Losse bestanden (patches, testfoto's, PDF's van
rem klanten) blijven op je laptop.
git add -u
git add src supabase deploy web scripts api README.md update-pico.bat package.json package-lock.json tsconfig.json 2>nul

git diff --cached --quiet
if not errorlevel 1 goto :geenwijziging
echo Gewijzigd:
git diff --cached --stat
echo.
set "OMSCHRIJVING="
set /p "OMSCHRIJVING=Wat heb je veranderd? Kort, Enter = Update Pico: "
if not defined OMSCHRIJVING set "OMSCHRIJVING=Update Pico"
git commit -q -m "%OMSCHRIJVING%" || goto :fout
goto :pushen

:geenwijziging
echo Geen nieuwe wijzigingen op je laptop; ik zet de laatste versie van GitHub op de server.

:pushen
for /f "delims=" %%v in ('git rev-parse origin/main') do set VORIGE=%%v
echo.
echo --- 1/3 Naar GitHub
git pull -q --rebase origin main || goto :fout
git push -q origin main || goto :fout
echo     gelukt

echo.
echo --- 2/3 Webinterface: Vercel bouwt hem nu zelf opnieuw (1-2 minuten)

rem Nieuwe database-wijzigingen? Die moeten met de hand in Supabase.
set MIGRATIE=
for /f "delims=" %%m in ('git diff --name-only %VORIGE% HEAD -- supabase/migrations') do (
  set MIGRATIE=1
  echo.
  echo     LET OP: nieuwe database-wijziging %%m
)
if defined MIGRATIE (
  echo     Plak die in Supabase: SQL Editor - New query - Run.
  echo     Doe dat VOOR je verder gaat, anders kan de bot fouten geven.
  echo.
  pause
)

echo.
echo --- 3/3 Server bijwerken en bot herstarten
ssh -t %SERVER% "cd ~/keukenbot && git pull -q origin main && sudo bash deploy/installeer-app.sh >/tmp/pico-update.log 2>&1 || { tail -30 /tmp/pico-update.log; exit 1; }; sudo systemctl restart keukenbot && sleep 8 && echo && echo Versie: && sudo -u keukenbot git -C /opt/keukenbot log -1 --format='   %%h %%s' && echo && echo Status: $(systemctl is-active keukenbot) && echo && sudo journalctl -u keukenbot -n 12 --no-pager -o cat" || goto :fout

echo.
echo === Klaar. Pico draait met de nieuwe versie. ===
echo.
pause
exit /b 0

:fout
echo.
echo === Er ging iets mis; zie de melding hierboven. Er is niets half op de server gezet als stap 3 niet begon. ===
echo.
pause
exit /b 1
