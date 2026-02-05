cmake_minimum_required(VERSION 3.20)

project(face_pipeline LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(FACE_PIPELINE_ENABLE_GMC "Enable Global Motion Compensation (requires OpenCV videostab)" ON)

if(APPLE)
  if(NOT DEFINED CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "Build universal binary")
  endif()
  set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
endif()

set(NCNN_INSTALL_DIR
    "${CMAKE_SOURCE_DIR}/third_party/ncnn-master/build/install"
    CACHE PATH "Path to ncnn install prefix"
)

list(APPEND CMAKE_PREFIX_PATH "${NCNN_INSTALL_DIR}")
find_package(ncnn REQUIRED)

# Main face pipeline executable (detection + tracking)
add_executable(face_pipeline
  src/main.cpp
  src/scrfd.cpp
  src/reid.cpp
  src/kalman_filter.cpp
  src/hungarian.cpp
  src/ocsort.cpp
  src/gmc.cpp
  src/pipeline.cpp
  src/stb_impl.cpp
)

target_include_directories(face_pipeline PRIVATE
  "${CMAKE_SOURCE_DIR}/include"
  "${CMAKE_SOURCE_DIR}/src"
)

target_link_libraries(face_pipeline PRIVATE ncnn)

if(FACE_PIPELINE_ENABLE_GMC)
  # Always compile a lightweight dependency-free GMC fallback. If OpenCV videostab
  # is available we'll prefer that backend at runtime, but universal builds can
  # still benefit from the fallback.
  target_compile_definitions(face_pipeline PRIVATE FACE_PIPELINE_GMC_FALLBACK=1)

  find_package(OpenCV QUIET COMPONENTS core imgproc video videostab)
  set(_gmc_opencv_ok OFF)
  if(OpenCV_FOUND)
    set(_gmc_opencv_ok ON)
    if(APPLE AND CMAKE_OSX_ARCHITECTURES MATCHES "x86_64")
      # Homebrew OpenCV is often arm64-only; avoid universal link failures.
      list(GET OpenCV_LIBS 0 _opencv_probe_lib)
      execute_process(
        COMMAND lipo -archs "${_opencv_probe_lib}"
        OUTPUT_VARIABLE _opencv_archs
        ERROR_QUIET
        OUTPUT_STRIP_TRAILING_WHITESPACE
      )
      if(NOT _opencv_archs MATCHES "x86_64")
        message(WARNING "OpenCV is not x86_64/universal; disabling GMC for universal build. Configure with -DCMAKE_OSX_ARCHITECTURES=arm64 to enable GMC.")
        set(_gmc_opencv_ok OFF)
      endif()
    endif()
  endif()

  if(_gmc_opencv_ok)
    target_compile_definitions(face_pipeline PRIVATE FACE_PIPELINE_GMC_OPENCV=1)
    target_include_directories(face_pipeline PRIVATE ${OpenCV_INCLUDE_DIRS})
    target_link_libraries(face_pipeline PRIVATE ${OpenCV_LIBS})
  elseif(NOT OpenCV_FOUND)
    message(WARNING "OpenCV (core,imgproc,video,videostab) not found; building without GMC.")
  endif()
endif()

if(APPLE)
  set_target_properties(face_pipeline PROPERTIES
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "@executable_path"
  )
endif()

install(TARGETS face_pipeline
  RUNTIME DESTINATION .
  BUNDLE DESTINATION .
)

if(APPLE)
  # Copy the actual dylib and create proper symlinks for macOS bundle
  file(GLOB NCNN_DYLIBS "${NCNN_INSTALL_DIR}/lib/libncnn*.dylib")
  install(FILES ${NCNN_DYLIBS} DESTINATION .)
elseif(WIN32)
  install(FILES "${NCNN_INSTALL_DIR}/bin/ncnn.dll" DESTINATION .)
endif()

# Note: The old scrfd_cli functionality is now part of face_pipeline
# Use: face_pipeline --model <dir> --image <path> for single image detection
