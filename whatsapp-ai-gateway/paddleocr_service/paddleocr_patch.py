import os as _os

# Force legacy executor paths on Windows where PaddlePaddle 3.3.1 + OneDNN is broken
# under PIR (PIR ArrayAttribute/DoubleAttribute conversion).
_os.environ.setdefault('FLAGS_enable_pir_in_executor', '0')
_os.environ.setdefault('FLAGS_enable_pir_api', '0')
_os.environ.setdefault('FLAGS_use_mkldnn', '0')

import paddle as _paddle

try:
    _paddle.set_flags({
        'FLAGS_enable_pir_in_executor': False,
        'FLAGS_enable_pir_api': False,
        'FLAGS_use_mkldnn': False,
    })
except Exception:
    pass

try:
    import paddlex.inference.models.runners.paddle_static.runner as _runner

    _original_create = _runner.PaddleStaticRunner._create

    def _patched_create(self):
        paddle = _paddle
        paddle_inference = paddle.inference
        from paddlex.inference.models.runners.paddle_static.runner import (
            CACHE_DIR,
            check_supported_device_type,
            get_model_paths,
        )

        model_paths = get_model_paths(self.model_dir, self.model_file_prefix)
        if 'paddle' not in model_paths:
            raise RuntimeError('No valid PaddlePaddle model found')

        check_supported_device_type(self._config['device_type'], self._model_name)

        model_file, params_file = model_paths['paddle']

        if self._config['device_type'] == 'gpu':
            if self._config.get('run_mode') == 'paddle_fp16':
                PrecisionType = paddle_inference.PrecisionType
                precision = PrecisionType.Half
                config = paddle_inference.Config(str(model_file), str(params_file))
                config.exp_disable_mixed_precision_ops({'feed', 'fetch'})
                config.enable_use_gpu(100, self._config.get('device_id', 0), precision)
            else:
                config = paddle_inference.Config(str(model_file), str(params_file))
                config.exp_disable_mixed_precision_ops({'feed', 'fetch'})
                config.enable_use_gpu(100, self._config.get('device_id', 0))
            config.enable_new_ir(False)
            config.enable_new_executor()
        else:
            config = paddle_inference.Config(str(model_file), str(params_file))
            config.enable_new_ir(False)
            config.enable_new_executor()
            if self._config['device_type'] == 'cpu':
                config.disable_mkldnn()
                config.set_cpu_math_library_num_threads(self._config.get('cpu_threads', 10))

        name = 'PaddleX_' + self._config.get('model_name', self._model_name)
        config.set_optim_cache_dir(str(self.model_dir / CACHE_DIR / name))

        for del_pass in self._config.get('delete_passes', []):
            config.delete_pass(del_pass)

        self.predictor = paddle_inference.create_predictor(config)
        return self.predictor

    _runner.PaddleStaticRunner._create = _patched_create
except Exception:
    pass
