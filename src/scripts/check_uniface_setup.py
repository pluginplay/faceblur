#!/usr/bin/env python3
"""
Verification script to check if UniFace is properly configured for Apple Silicon
Checks for CoreML support and ONNX Runtime providers
"""

import sys

def check_uniface_setup():
    """Check UniFace installation and hardware acceleration"""
    print("=" * 60)
    print("UniFace Apple Silicon Setup Verification")
    print("=" * 60)
    print()
    
    # Check ONNX Runtime providers
    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        print("✓ ONNX Runtime installed")
        print(f"  Available providers: {providers}")
        
        if 'CoreMLExecutionProvider' in providers:
            print("  ✅ CoreML support detected (Apple Silicon optimized)")
        else:
            print("  ⚠️  CoreML support NOT detected")
            print("     This may indicate CPU-only installation")
        
        if 'CUDAExecutionProvider' in providers:
            print("  ℹ️  CUDA support detected (NVIDIA GPU)")
        
        print()
    except ImportError:
        print("✗ ONNX Runtime not installed")
        print()
    
    # Check UniFace installation
    try:
        import uniface
        print(f"✓ UniFace installed: {uniface.__version__ if hasattr(uniface, '__version__') else 'unknown version'}")
        
        # Try to import and initialize RetinaFace
        from uniface import RetinaFace
        print("✓ RetinaFace import successful")
        
        # Check if we can create a detector
        try:
            detector = RetinaFace()
            print("✓ RetinaFace initialization successful")
        except Exception as e:
            print(f"✗ RetinaFace initialization failed: {e}")
        
        print()
    except ImportError as e:
        print(f"✗ UniFace not installed or import failed: {e}")
        print()
        return False
    
    # Check platform
    import platform
    print(f"Platform: {platform.system()} {platform.machine()}")
    if platform.machine() == 'arm64':
        print("✓ Running on Apple Silicon (ARM64)")
        if 'CoreMLExecutionProvider' not in providers:
            print()
            print("⚠️  WARNING: You're on Apple Silicon but CoreML is not available!")
            print("   Reinstall with: pip install 'uniface[silicon]>=0.1.2'")
            print("   Then reinstall: pip install --upgrade --force-reinstall 'uniface[silicon]>=0.1.2'")
    else:
        print(f"ℹ️  Running on {platform.machine()} (not Apple Silicon)")
    
    print()
    print("=" * 60)
    
    return True

if __name__ == "__main__":
    success = check_uniface_setup()
    sys.exit(0 if success else 1)

