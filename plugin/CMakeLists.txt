# VECTOR as a plugin: VST3 (macOS + Linux), AU (macOS) and a standalone app.
# The DSP is the C++ port in Source/dsp; the UI is the web UI (../dist)
# embedded into the binary and shown in a WebView.
#
#   ./build.sh            builds the web UI, then the plugins, and installs them
#
# or by hand:
#   npm run build   (in the repo root; the UI must exist before configuring)
#   cmake -S plugin -B plugin/build -G Ninja -DCMAKE_BUILD_TYPE=Release
#   cmake --build plugin/build

cmake_minimum_required(VERSION 3.22)
project(Vector VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.15
  GIT_SHALLOW TRUE
  # let the Linux WebView use the GPU (see patch-juce.cmake)
  PATCH_COMMAND ${CMAKE_COMMAND} -P ${CMAKE_CURRENT_SOURCE_DIR}/patch-juce.cmake)
FetchContent_MakeAvailable(JUCE)

# Copy the built plugins into the user's plugin folders (off in CI).
option(VECTOR_INSTALL "Install the plugins after building" ON)

set(VECTOR_FORMATS VST3 Standalone)
if(APPLE)
  list(APPEND VECTOR_FORMATS AU)
endif()

juce_add_plugin(Vector
  COMPANY_NAME "FT"
  BUNDLE_ID "com.ft.vector"
  PLUGIN_MANUFACTURER_CODE Ftft
  PLUGIN_CODE Vect
  PRODUCT_NAME "Vector"
  DESCRIPTION "clean-digital synth"
  FORMATS ${VECTOR_FORMATS}
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS TRUE
  NEEDS_WEB_BROWSER TRUE
  VST3_CATEGORIES Instrument Synth
  AU_MAIN_TYPE kAudioUnitType_MusicDevice
  NEEDS_WEBVIEW2 TRUE
  COPY_PLUGIN_AFTER_BUILD ${VECTOR_INSTALL})

target_sources(Vector PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp)

target_include_directories(Vector PRIVATE Source)

target_compile_definitions(Vector PUBLIC
  JUCE_WEB_BROWSER=1
  JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

# The built web UI, embedded. Rebuild it (npm run build) and re-run the build
# after changing anything under src/.
set(VECTOR_UI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../dist")
if(NOT EXISTS "${VECTOR_UI_DIR}/index.html")
  message(FATAL_ERROR "No web UI in ${VECTOR_UI_DIR}: run `npm run build` in the repo root first (or use plugin/build.sh).")
endif()
file(GLOB_RECURSE VECTOR_UI_FILES CONFIGURE_DEPENDS "${VECTOR_UI_DIR}/*")
juce_add_binary_data(VectorUI SOURCES ${VECTOR_UI_FILES})

target_link_libraries(Vector
  PRIVATE
    VectorUI
    juce::juce_audio_utils
    juce::juce_gui_extra
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags)
