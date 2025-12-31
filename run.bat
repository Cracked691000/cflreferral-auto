@echo off
echo ====================================
echo Crossfire Legends Referral Bot Setup
echo ====================================
echo Installing dependencies...
echo.

npm install

echo.
echo ====================================
echo Building project...
echo.

npm run build

echo.
echo ====================================
echo Starting automation...
echo Bot will automatically generate temp email
echo No credentials needed!
echo.

npm run dev

echo.
echo ====================================
echo Process completed!
echo ====================================
pause
