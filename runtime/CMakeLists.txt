# LVGL Web Designer — WASM runtime (build with emcmake, see build.sh)
cmake_minimum_required(VERSION 3.16)
project(lvgl_runtime C CXX)   # CXX: thorvg internal (lottie) is C++

# --- LVGL (vendored, read-only) ---------------------------------------------
# Source dir is a parameter: build.sh passes -DLVD_LVGL_DIR so the tag/location
# is pinned in one place (see runtime/build.sh). Defaults to the historical
# ../vendor/lvgl so a bare `cmake` still works.
set(LVD_LVGL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../vendor/lvgl" CACHE PATH
    "LVGL source tree to build against")
if(NOT EXISTS "${LVD_LVGL_DIR}/lvgl.h")
    message(FATAL_ERROR
        "LVGL sources not found at ${LVD_LVGL_DIR}. "
        "Run runtime/build.sh (it clones the pinned LVGL_TAG), or pass -DLVD_LVGL_DIR=<path>.")
endif()

# LVGL consumes LV_BUILD_CONF_PATH (not the older LV_CONF_PATH).
set(LV_BUILD_CONF_PATH ${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h CACHE PATH "" FORCE)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
# NOTE: keep this cmake option OFF: lvgl's SOURCES glob already compiles
# src/libs/thorvg/*.cpp into the lvgl target (gated by LV_USE_THORVG_INTERNAL
# in lv_conf.h); ON would additionally build a redundant lvgl_thorvg lib with
# the same symbols.
set(CONFIG_LV_USE_THORVG_INTERNAL OFF CACHE BOOL "" FORCE)

add_subdirectory(${LVD_LVGL_DIR} lvgl_build)

# --- Bridge ------------------------------------------------------------------
# The product baseline is LVGL 9.5, whose open-source tree no longer contains
# the XML engine. Keep the old bridge as an explicit migration-only build mode;
# never compile both hosts into one binary because they own the same lifecycle
# and registry symbols.
option(LVD_LEGACY_XML_BRIDGE "Build the LVGL 9.4 XML migration runtime" OFF)
set(LVD_BRIDGE_SOURCES src/bridge_hit.c src/bridge_log.c)
if(LVD_LEGACY_XML_BRIDGE)
    file(GLOB EXTRA_PARSER_SOURCES CONFIGURE_DEPENDS
         ${CMAKE_CURRENT_SOURCE_DIR}/src/xml_parsers_extra/*.c)
    list(APPEND LVD_BRIDGE_SOURCES src/bridge.c ${EXTRA_PARSER_SOURCES})
else()
    list(APPEND LVD_BRIDGE_SOURCES src/preview_host.c src/preview_driver.c)
endif()
add_executable(lvgl_runtime ${LVD_BRIDGE_SOURCES})
# thorvg (C++) objects inside liblvgl need libc++ at link time
set_target_properties(lvgl_runtime PROPERTIES LINKER_LANGUAGE CXX)
target_link_libraries(lvgl_runtime lvgl)
target_include_directories(lvgl_runtime PRIVATE ${LVD_LVGL_DIR})

# The 9.5 host writes directly to Module.canvas and owns its pointer/encoder
# indevs. SDL2 is linked only for the explicit 9.4 migration build.
target_compile_options(lvgl PRIVATE -Os)   # LVGL body: size first
target_compile_options(lvgl_runtime PRIVATE -Os)
set(LVD_RUNTIME_METHODS
    "cwrap,ccall,UTF8ToString,stringToNewUTF8,lengthBytesUTF8,stringToUTF8,HEAPU8,HEAP32,FS")
if(LVD_LEGACY_XML_BRIDGE)
    set(SDL2_PORT_FLAG "--use-port=sdl2")
    target_compile_definitions(lvgl PRIVATE LV_USE_SDL=1)
    target_compile_definitions(lvgl_runtime PRIVATE LV_USE_SDL=1)
    target_compile_options(lvgl PRIVATE ${SDL2_PORT_FLAG})
    target_compile_options(lvgl_runtime PRIVATE ${SDL2_PORT_FLAG})
    set(LVD_RUNTIME_METHODS "${LVD_RUNTIME_METHODS},specialHTMLTargets")
endif()

set(EM_LINK_FLAGS
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createLvglRuntime"
    "-sENVIRONMENT=web"
    # 32 MB initial heap; partial draw buffers keep display memory bounded.
    "-sINITIAL_MEMORY=33554432"
    "-sALLOW_MEMORY_GROWTH=1"
    # expat + LVGL layout recursion headroom
    "-sSTACK_SIZE=1048576"
    "-sEXPORTED_RUNTIME_METHODS=${LVD_RUNTIME_METHODS}"
    "-sEXPORTED_FUNCTIONS=_malloc,_free"   # EMSCRIPTEN_KEEPALIVE exports merge in automatically
    "-sFORCE_FILESYSTEM=1"                 # MEMFS carries user-uploaded images/fonts
    "-sSINGLE_FILE=0"
    "--no-entry"                           # no main(); JS drives everything via lvd_init
    "-Os")
if(LVD_LEGACY_XML_BRIDGE)
    list(APPEND EM_LINK_FLAGS ${SDL2_PORT_FLAG})
endif()
target_link_options(lvgl_runtime PRIVATE ${EM_LINK_FLAGS})

# .mjs suffix => emcc emits an ES module + separate .wasm
set_target_properties(lvgl_runtime PROPERTIES SUFFIX ".mjs")
