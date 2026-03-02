cmake_minimum_required(VERSION 3.20)

project(face_pipeline LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(FACE_PIPELINE_ENABLE_GMC "Enable OpenCV-backed GMC (dependency-heavy on macOS)" OFF)

if(APPLE)
  if(NOT DEFINED CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "Build architecture")
  endif()
  set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum macOS version")
endif()

find_package(onnxruntime REQUIRED CONFIG)
if(NOT TARGET onnxruntime::onnxruntime)
  if(TARGET onnxruntime)
    add_library(onnxruntime::onnxruntime INTERFACE IMPORTED)
    target_link_libraries(onnxruntime::onnxruntime INTERFACE onnxruntime)
  else()
    message(FATAL_ERROR "onnxruntime package found but no usable CMake target exported")
  endif()
endif()

# Main face pipeline executable (detection + tracking)
add_executable(face_pipeline
  src/main.cpp
  src/io/frame_source.cpp
  src/associate/face_person_associator.cpp
  src/detect/face_detector.cpp
  src/detect/person_detector.cpp
  src/reid/body_reid_extractor.cpp
  src/link/tracklet_linker.cpp
  src/infer/ort_runtime.cpp
  src/infer/image_ops.cpp
  src/scrfd.cpp
  src/kalman_filter.cpp
  src/hungarian.cpp
  src/ocsort.cpp
  src/gmc.cpp
  src/pipeline/adapters.cpp
  src/pipeline/pipeline_runner.cpp
  src/pipeline.cpp
  src/stb_impl.cpp
)

target_include_directories(face_pipeline PRIVATE
  "${CMAKE_SOURCE_DIR}/include"
  "${CMAKE_SOURCE_DIR}/src"
)

target_link_libraries(face_pipeline PRIVATE onnxruntime::onnxruntime)

if(FACE_PIPELINE_ENABLE_GMC)
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
    INSTALL_RPATH "@executable_path;@executable_path/lib"
  )
endif()

install(TARGETS face_pipeline
  RUNTIME DESTINATION .
  BUNDLE DESTINATION .
)

# Note: The old scrfd_cli functionality is now part of face_pipeline
# Use: face_pipeline --model <dir> --image <path> for single image detection
