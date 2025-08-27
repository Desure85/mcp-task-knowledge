## GNUmakefile: делегирование в расширенный Makefile
## Почему: по умолчанию GNU Make предпочитает GNUmakefile и игнорирует Makefile.
## Этот файл проксирует все цели в `Makefile`, где находится полный набор команд.

.PHONY: help %

help:
	@$(MAKE) -f Makefile help

# Делегируем любые цели в основной Makefile
%:
	@$(MAKE) -f Makefile $@
