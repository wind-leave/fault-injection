function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function radix2(real, imaginary, inverse = false) {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / width;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const half = width / 2;
    for (let start = 0; start < size; start += width) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

/**
 * Forward complex FFT for an arbitrary number of coherent samples.
 * Bluestein's transform preserves a 100,000-point PRI window exactly instead
 * of silently rounding it to 131,072 points and misreporting its resolution.
 */
export function fftComplexForward(inputReal, inputImaginary) {
  const size = inputReal.length;
  if (!size || inputImaginary.length !== size) {
    return { real: new Float64Array(), imaginary: new Float64Array() };
  }
  if (isPowerOfTwo(size)) {
    const real = Float64Array.from(inputReal);
    const imaginary = Float64Array.from(inputImaginary);
    radix2(real, imaginary);
    return { real, imaginary };
  }

  const convolutionSize = nextPowerOfTwo(size * 2 - 1);
  const leftReal = new Float64Array(convolutionSize);
  const leftImaginary = new Float64Array(convolutionSize);
  const rightReal = new Float64Array(convolutionSize);
  const rightImaginary = new Float64Array(convolutionSize);
  for (let index = 0; index < size; index += 1) {
    const phase = Math.PI * index * index / size;
    const cosine = Math.cos(phase);
    const sine = Math.sin(phase);
    leftReal[index] = inputReal[index] * cosine + inputImaginary[index] * sine;
    leftImaginary[index] = inputImaginary[index] * cosine - inputReal[index] * sine;
    rightReal[index] = cosine;
    rightImaginary[index] = sine;
    if (index) {
      rightReal[convolutionSize - index] = cosine;
      rightImaginary[convolutionSize - index] = sine;
    }
  }
  radix2(leftReal, leftImaginary);
  radix2(rightReal, rightImaginary);
  for (let index = 0; index < convolutionSize; index += 1) {
    const real = leftReal[index] * rightReal[index] - leftImaginary[index] * rightImaginary[index];
    leftImaginary[index] = leftReal[index] * rightImaginary[index] + leftImaginary[index] * rightReal[index];
    leftReal[index] = real;
  }
  radix2(leftReal, leftImaginary, true);

  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const phase = Math.PI * index * index / size;
    const cosine = Math.cos(phase);
    const sine = Math.sin(phase);
    real[index] = leftReal[index] * cosine + leftImaginary[index] * sine;
    imaginary[index] = leftImaginary[index] * cosine - leftReal[index] * sine;
  }
  return { real, imaginary };
}
