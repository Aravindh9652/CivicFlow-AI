package ai.civicflow.citizen

import java.security.MessageDigest
import kotlin.math.sqrt

/**
 * Open, on-device-capable encoder (same math as backend/local_ai.py).
 *
 * Honest NPU note: this runs on CPU. It is structured so the same first-pass
 * can later be swapped for an ONNX / Snapdragon NPU runtime. CivicFlow does
 * not claim NPU execution on this build.
 */
object LocalCivicModel {
    const val DIM = 128
    const val NAME = "CivicHashNgram-128 (open, on-device-capable)"

    fun embed(text: String, dim: Int = DIM): FloatArray {
        val vec = FloatArray(dim)
        val tokens = text.lowercase().map { if (it.isLetterOrDigit()) it else ' ' }
            .joinToString("")
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
        for (i in tokens.indices) {
            for (n in 1..3) {
                if (i + n > tokens.size) continue
                val gram = tokens.subList(i, i + n).joinToString(" ")
                val digest = MessageDigest.getInstance("MD5").digest(gram.toByteArray())
                val unsigned = ((digest[0].toLong() and 0xff) shl 24) or
                    ((digest[1].toLong() and 0xff) shl 16) or
                    ((digest[2].toLong() and 0xff) shl 8) or
                    (digest[3].toLong() and 0xff)
                val idx = (unsigned % dim).toInt()
                vec[idx] += 1f / n
            }
        }
        val norm = sqrt(vec.fold(0.0) { acc, v -> acc + v * v }.toFloat()).coerceAtLeast(1e-6f)
        for (i in vec.indices) vec[i] /= norm
        return vec
    }

    fun cosine(a: FloatArray, b: FloatArray): Float {
        var s = 0f
        for (i in a.indices) s += a[i] * b[i]
        return s
    }
}
