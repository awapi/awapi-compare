# AwapiCompare Windows Explorer command handler (native).
#
# Builds AwapiCompareShellExt.dll — an in-process COM server implementing
# IExplorerCommand for the three Explorer verbs (CompareTwo / SelectLeft /
# ComparePending). See README.md for build + registration instructions.
#
# Build (from this directory, on Windows with MSVC + the Windows SDK):
#   cmake -S . -B build -A x64
#   cmake --build build --config Release
#
# Output: build/Release/AwapiCompareShellExt.dll
cmake_minimum_required(VERSION 3.21)

project(AwapiCompareShellExt LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "AwapiCompareShellExt is a Windows-only COM component.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(AwapiCompareShellExt SHARED
  src/dllmain.cpp
  AwapiCompareShellExt.def
)

target_link_libraries(AwapiCompareShellExt PRIVATE
  shlwapi
  shell32
  ole32
)

# Unicode everywhere; this is a shell extension.
target_compile_definitions(AwapiCompareShellExt PRIVATE UNICODE _UNICODE)

# Keep the runtime self-contained so Explorer can load the DLL without the
# MSVC redistributable being present on the user's machine.
if(MSVC)
  set_property(TARGET AwapiCompareShellExt PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded")
  target_compile_options(AwapiCompareShellExt PRIVATE /W4 /permissive-)
endif()

set_target_properties(AwapiCompareShellExt PROPERTIES
  OUTPUT_NAME "AwapiCompareShellExt"
  PREFIX ""
)
