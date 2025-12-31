@echo off
echo ====================================
echo Crossfire Referral Bot
echo ====================================
echo Setting up credentials...
echo.

REM IMPORTANT: Replace with your actual Levelinf password
set LEVELINF_PASSWORD=YOUR_ACTUAL_LEVELINF_PASSWORD_HERE

echo Email: %LEVELINF_EMAIL%
echo Password: [HIDDEN]
echo.
echo Starting automation...
echo.

npx ts-node src/index.ts

echo.
echo ====================================
echo Process completed!
echo ====================================
pause
