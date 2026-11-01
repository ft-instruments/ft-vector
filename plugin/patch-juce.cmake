# Run by FetchContent in JUCE's source directory after it is downloaded.
#
# On Linux JUCE's WebView (WebKitGTK) is created with hardware acceleration
# set to "never", so the whole page is painted on the CPU. The editor's
# full-window animated background then repaints everything every frame:
# 7-8 fps. With acceleration "always" it runs at the display rate.
# (PluginEditor.cpp also makes WebKit hand frames over in shared memory, which
# is what makes the GPU path work on NVIDIA.)

set(file "modules/juce_gui_extra/native/juce_WebBrowserComponent_linux.cpp")
file(READ "${file}" src)
set(never "webkitHadwareAccelerationPolicyNeverFlag = 2;")
set(always "webkitHadwareAccelerationPolicyNeverFlag = 1;   // patched by Vector: WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS")
string(FIND "${src}" "${never}" at)
if(at GREATER -1)
  string(REPLACE "${never}" "${always}" src "${src}")
  file(WRITE "${file}" "${src}")
else()
  string(FIND "${src}" "patched by Vector" done)
  if(done EQUAL -1)
    message(FATAL_ERROR "patch-juce.cmake: the WebKit acceleration flag is not in ${file} any more; check the JUCE version")
  endif()
endif()
