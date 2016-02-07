/* @flow */

type Sink<T> = ( payload:T ) => void
type Disposer = () => void
export type Stream<T> = ( s:Sink<T> ) => Disposer
type Fn<A,B> = ( x:A ) => B
type LiftedFn<A,B> = ( x:Stream<A> ) => Stream<B>

// A helper to utilize Flow's Disjoint Unions
// http://flowtype.org/blog/2015/07/03/Disjoint-Unions.html
//
type Maybe<T> = {type: "just", value: T} | {type: "nothing"}


// We're not sure yet if this function should be public
function fromArray<T>( xs:Array<T> ): Stream<T> {
  return sink => {
    xs.forEach(x => {
      sink(x)
    })
    return () => {}
  }
}



/* Represents an empty stream
 */
export const empty:Stream<any> = () => () => {}


/* Creates a stream containing given value
 */
export function just<A>( x:A ): Stream<A> {
  return sink => {
    sink(x)
    return () => {}
  }
}


/* Lifts function `A => B` to a function that operates
 * on streams `Stream<A> => Stream<B>`
 */
export function map<A,B>( fn:Fn<A,B> ): LiftedFn<A,B> {
  return stream =>
    sink => stream(payload => sink(fn(payload)))
}


/* Given a predicate `A => boolean` returns a function
 * that operates on streams `Stream<A> => Stream<A>`.
 * The result function returns a stream without values that don't satisfy predicate.
 */
export function filter<A>( predicate:Fn<A,boolean> ): LiftedFn<A,A> {
  return stream =>
    sink => stream(payload => {
      if (predicate(payload)) {
        sink(payload)
      }
    })
}


/* Given a function `A => Stream<B>` returns a function
 * that operates on streams `Stream<A> => Stream<B>`.
 * The result function will spawn a `Stream<B>`
 * for each value from `Stream<A>` using the provided function.
 * The final `Stream<B>` will contain values from all spawned streams.
 */
export function chain<A,B>( fn:Fn<A,Stream<B>> ): LiftedFn<A,B> {
  return stream =>
    sink => {
      let spawnedDisposers = []
      const mainDisposer = stream(payload => {
        spawnedDisposers.push(fn(payload)(sink))
      })
      return () => {
        spawnedDisposers.forEach(fn => fn())
        mainDisposer()
      }
    }
}


/* Same as `chain()`, except the final stream will contain
 * only that values from each spawned streams that was
 * emitted before the next stream was spawned.
 */
export function chainLatest<A,B>( fn:Fn<A,Stream<B>> ): LiftedFn<A,B> {
  return stream =>
    sink => {
      let spawnedDisposers = () => {}
      const mainDisposer = stream(payload => {
        spawnedDisposers()
        spawnedDisposers = fn(payload)(sink)
      })
      return () => {
        spawnedDisposers()
        mainDisposer()
      }
    }
}


/* Given a stream of functions `Stream<A => B>`, returns a function
 * that operates on streams `Stream<A> => Stream<B>`.
 * The result stream `Stream<B>` will contain values created by applying
 * the latest function from `Stream<A => B>` to the latest value from `Stream<A>`
 * every time one of them updates.
 */
export function ap<A,B>( streamf:Stream<Fn<A,B>> ): LiftedFn<A,B> {
  return streamv =>
    sink => {
      let latestF: Maybe<Fn<A,B>> = {type: 'nothing'}
      let latestV: Maybe<A> = {type: 'nothing'}
      const push = () => {
        if (latestF.type === 'just' && latestV.type === 'just') {
          const fn = latestF.value
          sink(fn(latestV.value))
        }
      }
      const disposef = streamf(f => {
        latestF = {type: 'just', value: f}
        push()
      })
      const disposev = streamv(v => {
        latestV = {type: 'just', value: v}
        push()
      })
      return () => {
        disposef()
        disposev()
      }
    }
}


/* Lifts a 2 arity function `(A, B) => C` to a function that operates
 * on streams `(Stream<A>, Stream<B>) => Stream<C>`
 */
export function map2<A,B,C>( fn:( a:A, b:B ) => C ):
  ( sA:Stream<A>, sB:Stream<B> ) => Stream<C> {
  return (sA, sB) => {
    const ofFn = map(a => b => fn(a, b))(sA)
    return ap(ofFn)(sB)
  }
}


/* Lifts a 3 arity function `(A, B, C) => D` to a function that operates
 * on streams `(Stream<A>, Stream<B>, Stream<C>) => Stream<D>`
 */
export function map3<A,B,C,D>( fn:( a:A, b:B, c:C ) => D ):
  ( sA:Stream<A>, sB:Stream<B>, sC:Stream<C> ) => Stream<D> {
  return (sA, sB, sC) => {
    const ofFn = map(a => b => c => fn(a, b, c))(sA)
    return ap(ap(ofFn)(sB))(sC)
  }
}


/* Merges several streams of same type to a single stream of that type.
 * The result stream will contain values from all streams
 */
export function merge<T>( streams:Array<Stream<T>> ): Stream<T> {
  return chain(x => x)(fromArray(streams))
}


/* Given a reducer function `(B, A) => B`, and a seed value of type B,
 * returns a function that operates on streams `Stream<A> => Stream<B>`.
 * Will apply reducer to each value in `Stream<A>` and push the result to `Stream<B>`
 */
export function scan<A,B>( reducer:( r:B, x:A ) => B, seed:B ): LiftedFn<A,B> {
  return stream =>
    sink => {
      let current = seed
      sink(current)
      return stream(x => {
        current = reducer(current, x)
        sink(current)
      })
    }
}


/* Given a number N, returns a function that operates on streams `Stream<A> => Stream<A>`.
 * The result stream will contain only first N items from source stream
 */
export function take<A>( n:number ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let count = 0
      let disposer = null
      const dispose = () => {
        if (disposer !== null) {
          disposer()
          disposer = null
        }
      }
      disposer = stream(x => {
        count++
        if (count <= n) {
          sink(x)
        }
        if (count >= n) {
          dispose()
        }
      })
      if (count >= n) {
        dispose()
      }
      return dispose
    }
}


/* Given a predicate `A => boolean` returns a function
 * that operates on streams `Stream<A> => Stream<A>`.
 * The result stream will contain values from source stream
 * before the first value that doesn't satisfy predicate.
 */
export function takeWhile<A>( pred:Fn<A,boolean> ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let completed = false
      let disposer = null
      const dispose = () => {
        if (disposer !== null) {
          disposer()
          disposer = null
        }
      }
      disposer = stream(x => {
        if (!completed) {
          if (pred(x)) {
            sink(x)
          } else {
            completed = true
            dispose()
          }
        }
      })
      if (completed) {
        dispose()
      }
      return dispose
    }
}


/* Given a controller stream, returns a function that operates
 * on streams `Stream<A> => Stream<A>`. The result stream will contain values
 * from source stream until the first value from controller stream.
 */
export function takeUntil<A>( controller:Stream<mixed> ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let mainDisposer = null
      let ctrlDisposer = null
      const dispose = () => {
        if (mainDisposer !== null) {
          mainDisposer()
          mainDisposer = null
        }
        if (ctrlDisposer !== null) {
          ctrlDisposer()
          ctrlDisposer = null
        }
      }

      mainDisposer = stream(sink)
      ctrlDisposer = controller(dispose)

      // in case controller cb was called sync before we obtained ctrlDisposer
      if (mainDisposer === null) {
        dispose()
      }

      return dispose
    }
}


/* Given a number N, returns a function that operates on streams `Stream<A> => Stream<A>`.
 * The result stream will contain only items from source starting from (N+1)th one
 */
export function skip<A>( n:number ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let count = 0
      return stream(x => {
        count++
        if (count > n) {
          sink(x)
        }
      })
    }
}


/* Given a predicate `A => boolean` returns a function
 * that operates on streams `Stream<A> => Stream<A>`.
 * The result stream will contain values from source stream
 * starting from the first that doesn't satisfy predicate.
 */
export function skipWhile<A>( pred:Fn<A,boolean> ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let started = false
      return stream(x => {
        if (!started) {
          started = !pred(x)
        }
        if (started) {
          sink(x)
        }
      })
    }
}


/* Given a comparator function `(A, A) => boolean` returns a function that
 * operates on streams `Stream<A> => Stream<A>`. For each element X from
 * the source stream (except the first one) calls comparator with (Y, X)
 * as arguments, where Y is the last element in the result stream.
 * If comparator returns false, X goes to the result stream.
 */
export function skipDuplicates<A>( comp:( y:A, x:A ) => boolean ): LiftedFn<A,A> {
  return stream =>
    sink => {
      let latest:Maybe<A> = {type: 'nothing'}
      return stream(x => {
        if (latest.type === 'nothing' || !comp(latest.value, x)) {
          latest = {type: 'just', value: x}
          sink(x)
        }
      })
    }
}


/* Given a stream returns a new stream of same type. The new stream will
 * have at most one subscription at any given time to the original stream.
 * It allows you to connect several subscribers to a stream using only one subscription.
 */
export function multicast<A>( stream:Stream<A> ): Stream<A> {
  let sinks = []
  const push = x => {
    sinks.forEach(sink => {
      if (sinks.indexOf(sink) !== -1) {
        sink(x)
      }
    })
  }
  let unsub = null
  return sink => {
    let disposed = false
    sinks = [...sinks, sink]
    if (sinks.length === 1) {
      unsub = stream(push)
    }
    return () => {
      if (disposed) {
        return
      }
      disposed = true
      const index = sinks.indexOf(sink)
      sinks = [
        ...sinks.slice(0, index),
        ...sinks.slice(index + 1, sinks.length),
      ]
      if (sinks.length === 0 && unsub !== null) {
        unsub()
        unsub = null
      }
    }
  }
}


/* Given a value of type `A` returns a function that
 * operates on streams `Stream<A> => Stream<A>`.
 * The result stream is a copy of source stream
 * with the given value added at the beginning.
 */
export function startWith<A>( x:A ): LiftedFn<A,A> {
  return stream =>
    sink => {
      sink(x)
      return stream(sink)
    }
}


/* Given an array of streams returns a stream of arrays.
 * This is basically an implementation of FantasyLand's sequence() for Array
 * specialized to Streams.
 */
export function combineArray<A>( arr:Array<Stream<A>> ): Stream<Array<A>> {
  return arr.reduce(map2((arr, i) => arr.concat([i])), just([]))
}


const fromPairsLifted = map(pairs => {
  const result = {}
  pairs.forEach(([key, value]) => {
    result[key] = value
  })
  return result
})

/* Given an object (a.k.a map/hash) of streams returns a stream of objects.
 * Same as combineArray but for objects.
 */
export function combineObject<A>( obj:{[ k:string ]: Stream<A>} ): Stream<{[ k:string ]: A}> {
  const ofPairs = Object.keys(obj).map(  key => map(x => [key, x])(obj[key])  )
  return fromPairsLifted(combineArray(ofPairs))
}


type tReduced<R> = {
  '@@transducer/reduced': true,
  '@@transducer/value': R
}

type tTransformer<R,I> = {
  '@@transducer/result': ( result:R ) => R,
  '@@transducer/step': ( result:R, input:I ) => R|tReduced<R>
}

export type Transducer<A,B> = ( transformer:tTransformer<mixed,A> ) => tTransformer<mixed,B>

/* Given a transducer that conforms [Protocol][1],
 * returns a function that operates on streams `Stream<A> => Stream<B>`.
 *
 * [1]: https://github.com/cognitect-labs/transducers-js#the-transducer-protocol
 */
export function transduce<A,B>( transducer:Transducer<B,A> ): LiftedFn<A,B> {
  return stream =>
    sink => {
      let thisDisposed = false
      let sourceDisposer = null

      let transformer = transducer({
        '@@transducer/result'() {
        },
        '@@transducer/step'(result, input) {
          if (!thisDisposed) {
            sink(input)
          }
          return result
        },
      })

      const disposeSource = () => {
        if (sourceDisposer !== null) {
          sourceDisposer()
          sourceDisposer = null
        }
      }

      sourceDisposer = stream(x => {
        if (transformer === null) {
          return
        }

        // it returns either null or tReduced<null>
        if (null !== transformer['@@transducer/step'](null, x)) {
          transformer['@@transducer/result'](null)
          transformer = null
          disposeSource()
        }
      })

      if (transformer === null) {
        disposeSource()
      }

      return () => {
        thisDisposed = true
        disposeSource()
      }
    }
}
