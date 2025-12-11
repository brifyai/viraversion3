
import { assembleNewscast } from './lib/audio-assembler';
import path from 'path';
import fs from 'fs';

// Mock downloadAudio to return a local file
// We need to mock the downloadAudio function or ensure we have a valid URL/file
// For this test, we will assume we have a local file or use a dummy file creation

async function testElasticAudio() {
    console.log("🧪 Testing Elastic Audio...");

    // Create a dummy audio file (10 seconds of silence) using ffmpeg
    // This requires ffmpeg to be installed and available in the system path or via fluent-ffmpeg
    // Since we are in a test script, we might not have the full environment.
    // Instead, we will try to use an existing file if possible, or skip if not.

    // For the sake of this test, we will simulate the process by calling the function
    // with a dummy segment that points to a non-existent URL, expecting it to fail at download
    // BUT, we can mock the download function if we were using a testing framework.
    // Since we are running a script directly, we will try to use a real file if available.

    const testFile = path.join(process.cwd(), 'public', 'test_audio.mp3');

    // Check if we have any mp3 file in public/generated-audio to use as test
    const generatedDir = path.join(process.cwd(), 'public', 'generated-audio');
    let audioUrl = '';

    if (fs.existsSync(generatedDir)) {
        const files = fs.readdirSync(generatedDir).filter(f => f.endsWith('.mp3'));
        if (files.length > 0) {
            audioUrl = `/${files[0]}`; // Relative path as expected by downloadAudio
            console.log(`Using existing file for test: ${audioUrl}`);
        }
    }

    if (!audioUrl) {
        console.log("⚠️ No test audio file found. Skipping actual execution test.");
        return;
    }

    const segments = [
        {
            id: 'test-segment',
            audioUrl: audioUrl,
            duration: 10, // Dummy duration
            volume: 1.0
        }
    ];

    // Test Case 1: Force duration to 15 seconds (Stretch)
    console.log("\n--- Test Case 1: Stretch to 15s ---");
    const result1 = await assembleNewscast(segments, {
        forceExactDuration: true,
        targetDuration: 15,
        outputFormat: 'mp3'
    });

    if (result1.success) {
        console.log(`✅ Success! New duration: ${result1.duration}s (Target: 15s)`);
    } else {
        console.error(`❌ Failed: ${result1.error}`);
    }

    // Test Case 2: Force duration to 5 seconds (Compress)
    console.log("\n--- Test Case 2: Compress to 5s ---");
    const result2 = await assembleNewscast(segments, {
        forceExactDuration: true,
        targetDuration: 5,
        outputFormat: 'mp3'
    });

    if (result2.success) {
        console.log(`✅ Success! New duration: ${result2.duration}s (Target: 5s)`);
    } else {
        console.error(`❌ Failed: ${result2.error}`);
    }
}

testElasticAudio().catch(console.error);
