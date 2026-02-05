// Single compilation unit for stb_image implementation
// This prevents duplicate symbol errors when multiple files include stb_image.h

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
