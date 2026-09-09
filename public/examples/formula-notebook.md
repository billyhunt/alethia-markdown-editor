# The formula notebook

Small ideas, written precisely. Click an equation to see its TeX source, then move
the caret away to bring the typesetting back.

## A familiar beginning

For a right triangle, $a^2 + b^2 = c^2$. With legs of length $3$ and $4$, the
hypotenuse is $c = \sqrt{3^2 + 4^2} = 5$.

The same notation works in a sentence: $\alpha$, $\beta$, and $\theta$ can name
angles; $x_i$ can name a measurement; $\Delta x$ can describe a change.

## Finding the roots

For $ax^2 + bx + c = 0$ with $a \ne 0$, the quadratic formula is:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

Try changing the coefficients in this worked example:

$$
\begin{aligned}
x^2 - 5x + 6 &= 0 \\
(x - 2)(x - 3) &= 0 \\
x &= 2 \quad \text{or} \quad x = 3
\end{aligned}
$$

> The algebra is the argument. The layout should make that argument easier to follow.

## Signals in the noise

Here are five fictional readings from a sensor:

| Reading | Value | Deviation from mean | Squared deviation |
|:-------:|------:|--------------------:|------------------:|
| A | 8 | -2 | 4 |
| B | 9 | -1 | 1 |
| C | 10 | 0 | 0 |
| D | 11 | 1 | 1 |
| E | 12 | 2 | 4 |
| **Total** | **50** | **0** | **10** |

The mean is $\bar{x} = 10$. Treating these five readings as the entire population:

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i
\qquad
\sigma^2 = \frac{1}{n}\sum_{i=1}^{n}(x_i - \bar{x})^2 = 2
$$

A Gaussian density uses those two parameters:

$$
f(x) = \frac{1}{\sigma\sqrt{2\pi}}
\exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
$$

## Turn the page, rotate the plane

A rotation through angle $\theta$ can be written as a matrix:

$$
R(\theta) =
\begin{bmatrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{bmatrix}
$$

At $\theta = \frac{\pi}{2}$, the point $(1,0)$ moves to $(0,1)$:

$$
\begin{bmatrix}
0 & -1 \\
1 & 0
\end{bmatrix}
\begin{bmatrix}1\\0\end{bmatrix}
=
\begin{bmatrix}0\\1\end{bmatrix}
$$

## A little area under the curve

Integration turns a curve into an accumulated quantity:

$$
\int_0^1 x^2\,dx
= \left[\frac{x^3}{3}\right]_0^1
= \frac{1}{3}
$$

---

## Try it yourself

- [ ] Change the triangle's legs to $5$ and $12$.
- [ ] Add a sixth sensor reading and recalculate the mean.
- [ ] Replace the rotation angle with $\pi$.
- [ ] Change the integral's upper bound from $1$ to $2$.

Equations are typeset from the source you write; these examples do not calculate
or update their answers automatically.
