@echo off
REM Voice Clone Studio 测试脚本 (Windows)

echo ========================================
echo Voice Clone Studio 测试脚本
echo ========================================

REM 检查是否在正确的目录
if not exist "main.py" (
    echo [ERROR] 请在 backend 目录下运行此脚本
    exit /b 1
)

REM 默认参数
set ACTION=all
set VERBOSE=
set COVERAGE=
set QUICK=

REM 解析参数
:parse_args
if "%1"=="" goto run_tests

if "%1"=="unit" (
    set ACTION=unit
    shift
    goto parse_args
)

if "%1"=="integration" (
    set ACTION=integration
    shift
    goto parse_args
)

if "%1"=="api" (
    set ACTION=api
    shift
    goto parse_args
)

if "%1"=="all" (
    set ACTION=all
    shift
    goto parse_args
)

if "%1"=="lint" (
    set ACTION=lint
    shift
    goto parse_args
)

if "%1"=="types" (
    set ACTION=types
    shift
    goto parse_args
)

if "%1"=="coverage" (
    set ACTION=coverage
    shift
    goto parse_args
)

if "%1"=="install" (
    set ACTION=install
    shift
    goto parse_args
)

if "%1"=="-v" (
    set VERBOSE=--verbose
    shift
    goto parse_args
)

if "%1"=="--verbose" (
    set VERBOSE=--verbose
    shift
    goto parse_args
)

if "%1"=="-c" (
    set COVERAGE=--coverage
    shift
    goto parse_args
)

if "%1"=="--coverage" (
    set COVERAGE=--coverage
    shift
    goto parse_args
)

if "%1"=="--quick" (
    set QUICK=--quick
    shift
    goto parse_args
)

if "%1"=="-h" (
    goto show_help
)

if "%1"=="--help" (
    goto show_help
)

echo [ERROR] 未知选项: %1
echo 使用 test.bat --help 查看帮助
exit /b 1

:show_help
echo 用法: test.bat [命令] [选项]
echo.
echo 命令:
echo   unit         运行单元测试
echo   integration  运行集成测试
echo   api          运行 API 测试
echo   all          运行所有测试 ^(默认^)
echo   lint         运行代码检查
echo   types        运行类型检查
echo   coverage     运行测试并生成覆盖率报告
echo   install      安装测试依赖
echo.
echo 选项:
echo   -v, --verbose  显示详细输出
echo   -c, --coverage 生成覆盖率报告
echo   --quick        跳过慢速测试
echo   -h, --help     显示帮助信息
exit /b 0

:run_tests
REM 构建命令 (使用 uv)
set CMD=uv run pytest tests/ -v --tb=short

if defined VERBOSE (
    set CMD=%CMD% %VERBOSE%
)

if defined COVERAGE (
    set CMD=%CMD% %COVERAGE%
)

if defined QUICK (
    set CMD=%CMD% %QUICK%
)

REM 执行命令
echo [INFO] 执行命令: %CMD%
echo.

REM 运行命令
%CMD%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] 测试执行成功
    exit /b 0
) else (
    echo.
    echo [ERROR] 测试执行失败
    exit /b 1
)